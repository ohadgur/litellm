import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/shared/filters/http-exception.filter';
import { ConfigService } from '../../src/config/config.service';
import { AuthService } from '../../src/auth/auth.service';
import { RouterService } from '../../src/router/router.service';

describe('Gateway (e2e)', () => {
  let app: INestApplication;
  let configService: ConfigService;
  let authService: AuthService;
  let routerService: RouterService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    configService = app.get(ConfigService);
    authService = app.get(AuthService);
    routerService = app.get(RouterService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /ping', () => {
    it('should return "pong"', () => {
      return request(app.getHttpServer())
        .get('/ping')
        .expect(200)
        .expect('pong');
    });
  });

  describe('GET /v1/models', () => {
    it('should return empty model list when no models configured', () => {
      return request(app.getHttpServer())
        .get('/v1/models')
        .expect(200)
        .expect((res) => {
          expect(res.body.object).toBe('list');
          expect(res.body.data).toEqual([]);
        });
    });

    it('should return configured models', () => {
      configService.setDeployments([
        {
          modelName: 'gpt-4',
          litellmParams: { model: 'gpt-4', apiKey: 'test' },
        },
      ]);

      return request(app.getHttpServer())
        .get('/v1/models')
        .expect(200)
        .expect((res) => {
          expect(res.body.object).toBe('list');
          expect(res.body.data).toHaveLength(1);
          expect(res.body.data[0].id).toBe('gpt-4');
          expect(res.body.data[0].object).toBe('model');
        });
    });
  });

  describe('GET /models', () => {
    it('should also work without v1 prefix', () => {
      return request(app.getHttpServer())
        .get('/models')
        .expect(200)
        .expect((res) => {
          expect(res.body.object).toBe('list');
        });
    });
  });

  describe('POST /v1/chat/completions', () => {
    it('should return 401 without auth header', () => {
      return request(app.getHttpServer())
        .post('/v1/chat/completions')
        .send({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
        })
        .expect(401)
        .expect((res) => {
          expect(res.body.error).toBeDefined();
          expect(res.body.error.type).toBe('invalid_request_error');
          expect(res.body.error.code).toBe('invalid_api_key');
        });
    });

    it('should return 401 with invalid API key', () => {
      return request(app.getHttpServer())
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-invalid-key')
        .send({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
        })
        .expect(401)
        .expect((res) => {
          expect(res.body.error).toBeDefined();
          expect(res.body.error.message).toContain('Invalid API key');
        });
    });
  });

  describe('GET /v1/models/:modelId', () => {
    it('should return 404 for unknown model', () => {
      configService.setDeployments([]);

      return request(app.getHttpServer())
        .get('/v1/models/nonexistent-model')
        .expect(404)
        .expect((res) => {
          expect(res.body.error).toBeDefined();
          expect(res.body.error.code).toBe('model_not_found');
        });
    });

    it('should return model details for existing model', () => {
      configService.setDeployments([
        {
          modelName: 'gpt-4',
          litellmParams: { model: 'gpt-4' },
        },
      ]);

      return request(app.getHttpServer())
        .get('/v1/models/gpt-4')
        .expect(200)
        .expect((res) => {
          expect(res.body.id).toBe('gpt-4');
          expect(res.body.object).toBe('model');
          expect(res.body.owned_by).toBe('litellm');
        });
    });
  });
});
