import { Controller, Get, Header, Param } from '@nestjs/common';
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

  @Get(':id/workflows/:provider')
  @Header('Content-Type', 'application/yaml; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="ci.yml"')
  workflow(@Param('id') id: string, @Param('provider') provider: string): string {
    return this.templates.importWorkflow(id, provider);
  }
}
