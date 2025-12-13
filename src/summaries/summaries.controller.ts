import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { GeneratedSummaryResponse, SummariesService } from './summaries.service';
import { GenerateSummaryDto } from './dto/generate-summary.dto';

@ApiTags('AI')
@Controller('ai/summaries')
export class SummariesController {
  constructor(private readonly summariesService: SummariesService) {}

  @Post('structured')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generate a structured summary from cleaned study materials'
  })
  async generateStructured(@Body() dto: GenerateSummaryDto): Promise<GeneratedSummaryResponse> {
    return this.summariesService.generateStructuredSummary(dto.content, dto.topic);
  }
}
