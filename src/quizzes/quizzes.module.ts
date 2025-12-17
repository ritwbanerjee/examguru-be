import { Module } from '@nestjs/common';
import { QuizzesService } from './quizzes.service';

@Module({
  providers: [QuizzesService],
  exports: [QuizzesService]
})
export class QuizzesModule {}
