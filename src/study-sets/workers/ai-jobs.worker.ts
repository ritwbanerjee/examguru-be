import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { AiJobsProcessorService } from '../ai-jobs.processor';

async function bootstrap() {
  const appContext = await NestFactory.createApplicationContext(AppModule);
  const processor = appContext.get(AiJobsProcessorService);

  await processor.startPolling();
}

bootstrap().catch(error => {
  // eslint-disable-next-line no-console
  console.error('AI job worker crashed', error);
  process.exit(1);
});
