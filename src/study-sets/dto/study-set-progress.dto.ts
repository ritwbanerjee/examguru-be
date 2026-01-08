export class StudySetProgressDto {
  studySetId!: string;
  flashcardsMastered!: number;
  quizAttempts!: number;
  quizAverageScore!: number | null;
}
