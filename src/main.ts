import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import helmet from 'helmet';
import * as cors from 'cors';
import { json } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const httpAdapter = app.getHttpAdapter()?.getInstance?.();
  if (httpAdapter?.disable) {
    httpAdapter.disable('etag');
  }
  app.setGlobalPrefix('api');

  app.use(
    cors({
      origin: ['http://localhost:4200'],
      credentials: true
    })
  );
  app.use(
    helmet({
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginResourcePolicy: { policy: 'same-site' }
    }) as any
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true
    })
  );

  const config = new DocumentBuilder()
    .setTitle('ExamGuru API')
    .setDescription('ExamGuru platform endpoints for authentication, study set creation, AI orchestration, and analytics.')
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT'
      },
      'bearer'
    )
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    useGlobalPrefix: true
  });

  await app.listen(process.env.PORT || 3000, "0.0.0.0");
}

bootstrap();
