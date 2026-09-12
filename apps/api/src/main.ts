import './load-env';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import type { Express } from 'express';
import { AppModule } from './app.module';
import { config } from './config';
import { validateConfig } from './config';
import { PrismaExceptionFilter } from './prisma/prisma-exception.filter';

async function bootstrap() {
  validateConfig();
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableShutdownHooks();
  const express = app.getHttpAdapter().getInstance() as Express;
  express.disable('x-powered-by');
  express.set('trust proxy', 1);
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
  console.log(`[platform-api] running at http://localhost:${port}/api`);
}

void bootstrap();
