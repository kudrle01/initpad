import { Controller, Get } from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { PublicEndpoint } from '../auth/public-endpoint.decorator';

@Controller('templates')
@PublicEndpoint('public-catalog')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  list() {
    return this.templates.list();
  }
}
