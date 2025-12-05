import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class GoogleLoginDto {
  @ApiProperty({ example: 'google-demo-token' })
  @IsString()
  @IsNotEmpty()
  token!: string;
}
