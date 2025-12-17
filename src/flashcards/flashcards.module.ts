import { Module } from '@nestjs/common';
import { FlashcardsService } from './flashcards.service';

@Module({
  providers: [FlashcardsService],
  exports: [FlashcardsService]
})
export class FlashcardsModule {}
