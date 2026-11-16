import './load-env';
import './instrumentation';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import type { Express } from 'express';
import { AppModule } from './app.module';
import {
  adoptBuiltInAppAddress,
  builtInAppsShareSessionCookie,
  config,
  validateConfig,
} from './config';
import { PrismaExceptionFilter } from './prisma/prisma-exception.filter';
import { requestContextMiddleware } from './common/request-context';
import { csrfProtection } from './common/csrf-protection';
import { StructuredLogger } from './common/structured-logger';
import { clearStaleWorkFiles } from './common/work-dir';

async function bootstrap() {
  validateConfig();
  const logger = new StructuredLogger();
  const staleWorkFiles = clearStaleWorkFiles();
  if (staleWorkFiles.length > 0) {
    logger.log(
      { event: 'platform.stale_work_files_removed', count: staleWorkFiles.length },
      'Bootstrap',
    );
  }
  // Before the module seeds the built-in targets (their static-host URL).
  const builtInAppHost = await adoptBuiltInAppAddress();
  if (builtInAppHost && 'address' in builtInAppHost) {
    logger.log(
      { event: 'platform.built_in_app_address', address: builtInAppHost.address },
      'Bootstrap',
    );
  } else if (builtInAppHost) {
    logger.warn(
      {
        event: 'deployment.built_in_app_host_hsts',
        host: builtInAppHost.unresolved,
        remedy:
          'Browsers force HTTPS on every port of the HTTPS platform host, so built-in app links on it fail. Set INITPAD_DEPLOY_PUBLIC_HOST to the server IP address.',
      },
      'Bootstrap',
    );
  }
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    logger,
  });
  app.enableShutdownHooks();
  const express = app.getHttpAdapter().getInstance() as Express;
  express.disable('x-powered-by');
  express.set('trust proxy', config.http.trustProxyHops || false);
  app.use(requestContextMiddleware);
  app.use(
    (
      _req: unknown,
      res: { setHeader: (name: string, value: string) => void },
      next: () => void,
    ) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
      next();
    },
  );
  app.enableCors({ origin: config.auth.frontendUrl, credentials: true });
  app.use(cookieParser());
  // Needs parsed cookies: only requests carrying the session are checked.
  app.use(csrfProtection);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new PrismaExceptionFilter());
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
  logger.log({ event: 'platform.started', port }, 'Bootstrap');
  if (builtInAppsShareSessionCookie()) {
    logger.warn(
      {
        event: 'security.session_shared_with_built_in_apps',
        remedy: 'Serve InitPad over HTTPS or set INITPAD_DEPLOY_PUBLIC_HOST to another host name',
      },
      'Bootstrap',
    );
  }
}

void bootstrap();
