import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from '../health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should return "pong" for ping', () => {
    expect(controller.ping()).toBe('pong');
  });

  it('should return status ok for selftest', () => {
    expect(controller.selftest()).toEqual({ status: 'ok' });
  });
});
