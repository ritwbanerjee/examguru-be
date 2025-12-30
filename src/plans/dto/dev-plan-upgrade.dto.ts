import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class DevPlanUpgradeDto {
  @ApiProperty({ example: 'student_lite' })
  @IsString()
  @IsNotEmpty()
  planId!: string;
}
