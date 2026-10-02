import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, type EmailOutbox } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import nodemailer, { type Transporter } from 'nodemailer';
import { config, mailDeliveryConfigured } from '../config';
import { decryptSecret, encryptSecret } from '../common/secret';
import { PrismaService } from '../prisma/prisma.service';

export type MailKind = 'email_verify' | 'password_reset' | 'activation';

export interface QueueAuthMailInput {
  userId: string;
  kind: MailKind;
  recipient: string;
  displayName: string | null;
  url: string;
}

type OutboxDatabase = Prisma.TransactionClient | PrismaService;

interface AuthMailPayload {
  displayName: string | null;
  url: string;
}

const POLL_INTERVAL_MS = 10_000;
const LEASE_TIMEOUT_MS = 5 * 60_000;
const MAX_ATTEMPTS = 8;
const MAX_BATCH_SIZE = 20;

@Injectable()
export class MailDeliveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('MailDeliveryService');
  private readonly workerId = randomUUID();
  private readonly transporter: Transporter | null;
  private timer?: NodeJS.Timeout;
  private activeSweep?: Promise<void>;

  constructor(private readonly prisma: PrismaService) {
    this.transporter = mailDeliveryConfigured()
      ? nodemailer.createTransport({
          host: config.mail.host,
          port: config.mail.port,
          secure: config.mail.secure,
          requireTLS: config.mail.requireTls,
          auth: config.mail.username
            ? { user: config.mail.username, pass: config.mail.password }
            : undefined,
          tls: { minVersion: 'TLSv1.2' },
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 20_000,
          pool: true,
        })
      : null;
  }

  isEnabled(): boolean {
    return this.transporter !== null;
  }

  onModuleInit(): void {
    if (!this.transporter) return;
    // Delivery availability must never delay API readiness. The durable row
    // remains queued while a relay is unavailable and is retried in-process.
    this.scheduleSweep();
    this.timer = setInterval(() => this.scheduleSweep(), POLL_INTERVAL_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.activeSweep?.catch(() => undefined);
    this.transporter?.close();
  }

  async enqueueAuthMail(db: OutboxDatabase, input: QueueAuthMailInput): Promise<void> {
    if (!this.transporter) {
      throw new Error('E-mail delivery is not configured');
    }
    const payload: AuthMailPayload = { displayName: input.displayName, url: input.url };
    await db.emailOutbox.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        recipient: input.recipient,
        payloadEncrypted: encryptSecret(JSON.stringify(payload)),
      },
    });
  }

  /** Wake the worker after the surrounding database transaction committed. */
  scheduleDelivery(): void {
    queueMicrotask(() => this.scheduleSweep());
  }

  /** Bounded drain used by startup, the timer and deterministic tests. */
  async flushPending(): Promise<void> {
    await this.runSweep();
  }

  private scheduleSweep(): void {
    void this.runSweep().catch(() => {
      // Prisma/transport errors may contain connection strings or recipient
      // data. Keep the operational signal structured and secret-free.
      this.logger.warn({ event: 'mail.outbox.sweep_failed' });
    });
  }

  private async runSweep(): Promise<void> {
    if (!this.transporter) return;
    if (this.activeSweep) return this.activeSweep;
    const sweep = this.drain();
    this.activeSweep = sweep;
    await sweep.finally(() => {
      if (this.activeSweep === sweep) this.activeSweep = undefined;
    });
  }

  private async drain(): Promise<void> {
    for (let processed = 0; processed < MAX_BATCH_SIZE; processed += 1) {
      const message = await this.claimNext();
      if (!message) return;
      await this.deliver(message);
    }
  }

  private async claimNext(): Promise<EmailOutbox | null> {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - LEASE_TIMEOUT_MS);
    const claimable: Prisma.EmailOutboxWhereInput = {
      OR: [
        { status: 'pending', availableAt: { lte: now } },
        { status: 'sending', lockedAt: { lte: staleBefore } },
      ],
    };
    const candidate = await this.prisma.emailOutbox.findFirst({
      where: claimable,
      orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
    });
    if (!candidate) return null;

    const claimed = await this.prisma.emailOutbox.updateMany({
      where: { id: candidate.id, ...claimable },
      data: {
        status: 'sending',
        lockedAt: now,
        lockOwner: this.workerId,
        attempts: { increment: 1 },
      },
    });
    if (claimed.count !== 1) return null;
    return this.prisma.emailOutbox.findUnique({ where: { id: candidate.id } });
  }

  private async deliver(message: EmailOutbox): Promise<void> {
    try {
      const payload = this.readPayload(message.payloadEncrypted);
      const rendered = renderAuthMail(message.kind as MailKind, payload);
      await this.transporter!.sendMail({
        from: config.mail.from,
        to: message.recipient,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        // Stable across a lease retry, allowing SMTP receivers to deduplicate
        // the rare crash-after-send-before-acknowledge case.
        messageId: `<${message.id}@${config.mail.host}>`,
      });
      await this.prisma.emailOutbox.updateMany({
        where: { id: message.id, status: 'sending', lockOwner: this.workerId },
        data: {
          status: 'sent',
          sentAt: new Date(),
          payloadEncrypted: '',
          lockedAt: null,
          lockOwner: null,
          lastError: null,
        },
      });
      this.logger.log({ event: 'mail.outbox.sent', id: message.id, kind: message.kind });
    } catch (error) {
      const terminal = message.attempts >= MAX_ATTEMPTS;
      const retryDelayMs = Math.min(60 * 60_000, 15_000 * 2 ** Math.max(0, message.attempts - 1));
      await this.prisma.emailOutbox.updateMany({
        where: { id: message.id, status: 'sending', lockOwner: this.workerId },
        data: {
          status: terminal ? 'failed' : 'pending',
          availableAt: terminal ? message.availableAt : new Date(Date.now() + retryDelayMs),
          payloadEncrypted: terminal ? '' : message.payloadEncrypted,
          lockedAt: null,
          lockOwner: null,
          lastError: safeError(error),
        },
      });
      this.logger.warn({
        event: terminal ? 'mail.outbox.failed' : 'mail.outbox.retry_scheduled',
        id: message.id,
        kind: message.kind,
        attempt: message.attempts,
      });
    }
  }

  private readPayload(stored: string): AuthMailPayload {
    const plaintext = decryptSecret(stored);
    if (!plaintext) throw new Error('Outbox payload cannot be decrypted');
    const payload = JSON.parse(plaintext) as Partial<AuthMailPayload>;
    if (typeof payload.url !== 'string' || !/^https?:\/\//.test(payload.url)) {
      throw new Error('Outbox payload is invalid');
    }
    return {
      displayName: typeof payload.displayName === 'string' ? payload.displayName : null,
      url: payload.url,
    };
  }
}

function renderAuthMail(kind: MailKind, payload: AuthMailPayload) {
  const heading = {
    email_verify: 'Verify your InitPad e-mail',
    password_reset: 'Reset your InitPad password',
    activation: 'Activate your InitPad account',
  }[kind];
  const action = {
    email_verify: 'Verify e-mail',
    password_reset: 'Reset password',
    activation: 'Activate account',
  }[kind];
  const greeting = payload.displayName ? `Hello ${payload.displayName},` : 'Hello,';
  const text = `${greeting}\n\n${heading}. Open this single-use link:\n${payload.url}\n\nIf you did not request this, you can ignore this message.`;
  const escapedUrl = escapeHtml(payload.url);
  return {
    subject: heading,
    text,
    html:
      `<p>${escapeHtml(greeting)}</p><p>${escapeHtml(heading)}.</p>` +
      `<p><a href="${escapedUrl}">${escapeHtml(action)}</a></p>` +
      '<p>If you did not request this, you can ignore this message.</p>',
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown SMTP error';
  return message
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/[\r\n\0]+/g, ' ')
    .slice(0, 500);
}
