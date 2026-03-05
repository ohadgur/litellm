import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ConfigService } from './config.service';

@Module({
  imports: [PrismaModule],
  providers: [ConfigService],
  exports: [ConfigService],
})
export class ConfigModule {}
