import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { reencryptedSecret, SecretDecryptionError } from './secret';

const BATCH_SIZE = 100;
const PREFIX = 'enc:v1:';

interface StoredValue {
  id: string;
  value: string | null;
}

interface EncryptedColumn {
  name: string;
  // Rows after `cursor` ordered by id; `pendingOnly` limits them to values
  // that are not encrypted yet.
  read(cursor: string | undefined, pendingOnly: boolean): Promise<StoredValue[]>;
  // Compare-and-set, so a concurrent change or another replica wins cleanly.
  write(id: string, previous: string, next: string): Promise<void>;
}

export interface ReencryptionSummary {
  reencrypted: number;
  unreadable: number;
}

/**
 * Moves stored secrets to the current INITPAD_ENCRYPTION_KEY (ADR-141): legacy
 * plaintext values on every start, and values written under a key listed in
 * INITPAD_ENCRYPTION_KEY_PREVIOUS while a rotation is in progress.
 */
@Injectable()
export class SecretReencryptionService implements OnApplicationBootstrap {
  private readonly logger = new Logger('SecretReencryption');

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    void this.reencryptStoredSecrets().catch((error) =>
      this.logger.warn(`Secret re-encryption skipped: ${(error as Error).message}`),
    );
  }

  async reencryptStoredSecrets(): Promise<ReencryptionSummary> {
    const rotating = config.security.previousEncryptionKeys.length > 0;
    const summary: ReencryptionSummary = { reencrypted: 0, unreadable: 0 };
    for (const column of this.columns()) {
      let cursor: string | undefined;
      for (;;) {
        const rows = await column.read(cursor, !rotating);
        for (const row of rows) {
          if (!row.value) continue;
          let next: string | null;
          try {
            next = reencryptedSecret(row.value);
          } catch (error) {
            if (!(error instanceof SecretDecryptionError)) throw error;
            summary.unreadable++;
            this.logger.warn({ event: 'secret.unreadable', column: column.name, id: row.id });
            continue;
          }
          if (next === null) continue;
          await column.write(row.id, row.value, next);
          summary.reencrypted++;
        }
        if (rows.length < BATCH_SIZE) break;
        cursor = rows[rows.length - 1].id;
      }
    }
    if (summary.reencrypted || summary.unreadable || rotating) {
      this.logger.log({ event: 'secret.reencryption', rotating, ...summary });
    }
    if (rotating && summary.unreadable === 0) {
      this.logger.log(
        'Every stored secret uses the current INITPAD_ENCRYPTION_KEY; ' +
          'INITPAD_ENCRYPTION_KEY_PREVIOUS can now be removed.',
      );
    }
    return summary;
  }

  private columns(): EncryptedColumn[] {
    // Explicit id ranges instead of Prisma cursors: a re-encrypted row no
    // longer matches the "not encrypted yet" filter.
    const page = { orderBy: { id: 'asc' as const }, take: BATCH_SIZE };
    const after = (cursor: string | undefined) => (cursor ? { id: { gt: cursor } } : {});
    const pending = { not: { startsWith: PREFIX } };
    const values = <T extends { id: string }>(rows: T[], value: (row: T) => string | null) =>
      rows.map((row) => ({ id: row.id, value: value(row) }));
    return [
      {
        name: 'User.accessToken',
        read: (cursor, pendingOnly) =>
          this.prisma.user
            .findMany({
              where: { ...after(cursor), ...(pendingOnly ? { accessToken: pending } : {}) },
              select: { id: true, accessToken: true },
              ...page,
            })
            .then((rows) => values(rows, (row) => row.accessToken)),
        write: async (id, previous, next) => {
          await this.prisma.user.updateMany({
            where: { id, accessToken: previous },
            data: { accessToken: next },
          });
        },
      },
      {
        name: 'ExternalIdentity.accessTokenEncrypted',
        read: (cursor, pendingOnly) =>
          this.prisma.externalIdentity
            .findMany({
              where: {
                ...after(cursor),
                ...(pendingOnly ? { accessTokenEncrypted: pending } : {}),
              },
              select: { id: true, accessTokenEncrypted: true },
              ...page,
            })
            .then((rows) => values(rows, (row) => row.accessTokenEncrypted)),
        write: async (id, previous, next) => {
          await this.prisma.externalIdentity.updateMany({
            where: { id, accessTokenEncrypted: previous },
            data: { accessTokenEncrypted: next },
          });
        },
      },
      {
        name: 'ExternalIdentity.refreshTokenEncrypted',
        read: (cursor, pendingOnly) =>
          this.prisma.externalIdentity
            .findMany({
              where: {
                ...after(cursor),
                ...(pendingOnly ? { refreshTokenEncrypted: pending } : {}),
              },
              select: { id: true, refreshTokenEncrypted: true },
              ...page,
            })
            .then((rows) => values(rows, (row) => row.refreshTokenEncrypted)),
        write: async (id, previous, next) => {
          await this.prisma.externalIdentity.updateMany({
            where: { id, refreshTokenEncrypted: previous },
            data: { refreshTokenEncrypted: next },
          });
        },
      },
      {
        name: 'EmailOutbox.payloadEncrypted',
        read: (cursor, pendingOnly) =>
          this.prisma.emailOutbox
            .findMany({
              where: { ...after(cursor), ...(pendingOnly ? { payloadEncrypted: pending } : {}) },
              select: { id: true, payloadEncrypted: true },
              ...page,
            })
            .then((rows) => values(rows, (row) => row.payloadEncrypted)),
        write: async (id, previous, next) => {
          await this.prisma.emailOutbox.updateMany({
            where: { id, payloadEncrypted: previous },
            data: { payloadEncrypted: next },
          });
        },
      },
      {
        name: 'Target.secret',
        read: (cursor, pendingOnly) =>
          this.prisma.target
            .findMany({
              where: { ...after(cursor), ...(pendingOnly ? { secret: pending } : {}) },
              select: { id: true, secret: true },
              ...page,
            })
            .then((rows) => values(rows, (row) => row.secret)),
        write: async (id, previous, next) => {
          await this.prisma.target.updateMany({
            where: { id, secret: previous },
            data: { secret: next },
          });
        },
      },
      {
        name: 'AppConfigVar.value',
        read: (cursor, pendingOnly) =>
          this.prisma.appConfigVar
            .findMany({
              where: {
                ...after(cursor),
                isSecret: true,
                ...(pendingOnly ? { value: pending } : {}),
              },
              select: { id: true, value: true },
              ...page,
            })
            .then((rows) => values(rows, (row) => row.value)),
        write: async (id, previous, next) => {
          await this.prisma.appConfigVar.updateMany({
            where: { id, isSecret: true, value: previous },
            data: { value: next },
          });
        },
      },
    ];
  }
}
