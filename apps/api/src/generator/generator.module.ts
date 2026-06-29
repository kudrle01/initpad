import { Module } from '@nestjs/common';
import { GeneratorService } from './generator.service';
import { TemplatesModule } from '../templates/templates.module';

@Module({
  imports: [TemplatesModule],
  providers: [GeneratorService],
  exports: [GeneratorService],
})
export class GeneratorModule {}
