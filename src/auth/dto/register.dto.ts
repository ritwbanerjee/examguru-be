import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'Ritwik' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'PlainText123!' })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  acceptTerms!: boolean;
}
