import { ApiProperty } from '@nestjs/swagger';

export class FlashcardDto {
  @ApiProperty({ example: 'fc_507f1f77bcf86cd799439011_file_abc123_000' })
  id!: string;

  @ApiProperty()
  studySetId!: string;

  @ApiProperty()
  fileId!: string;

  @ApiProperty()
  sourceFile!: string;

  @ApiProperty({ example: 'What is the derivative of x²?' })
  prompt!: string;

  @ApiProperty({ example: '2x' })
  answer!: string;

  @ApiProperty({ example: 'Remember the power rule: bring down the exponent and reduce it by 1' })
  followUp!: string;

  @ApiProperty({ enum: ['intro', 'intermediate', 'advanced'], example: 'intro' })
  difficulty!: string;

  @ApiProperty({ example: false })
  isEdited!: boolean;

  @ApiProperty({ example: null, nullable: true })
  editedAt!: Date | null;

  @ApiProperty({ example: true })
  mastered!: boolean;

  @ApiProperty({ example: 3 })
  timesStudied!: number;

  @ApiProperty({ example: '2025-12-23T09:15:00Z', nullable: true })
  lastReviewed!: Date | null;

  @ApiProperty()
  createdAt!: Date;
}

export class FlashcardGroupDto {
  @ApiProperty()
  fileId!: string;

  @ApiProperty()
  fileName!: string;

  @ApiProperty()
  totalCards!: number;

  @ApiProperty()
  masteredCards!: number;

  @ApiProperty({ type: [FlashcardDto] })
  cards!: FlashcardDto[];
}

export class FlashcardsResponseDto {
  @ApiProperty()
  studySetId!: string;

  @ApiProperty()
  totalCards!: number;

  @ApiProperty()
  masteredCards!: number;

  @ApiProperty()
  unmasteredCards!: number;

  @ApiProperty({ nullable: true })
  lastStudied!: Date | null;

  @ApiProperty({ type: [FlashcardGroupDto] })
  groups!: FlashcardGroupDto[];
}
