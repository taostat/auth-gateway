import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { AuthError } from './util/errors';

interface ErrorHandlerOptions {
  hideInternalErrors: boolean;
  logErrors: boolean;
}

export function createErrorHandler(opts: ErrorHandlerOptions) {
  return (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      const issues = error.validation.map((v) => v.message).join('; ');
      return reply.code(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: issues,
      });
    }

    if (error instanceof AuthError) {
      return reply.code(error.statusCode).send({
        error: error.error,
        error_description: error.message,
        statusCode: error.statusCode,
        message: error.message,
      });
    }

    if (error.statusCode === 429) {
      return reply.code(429).send({
        statusCode: 429,
        error: 'Too Many Requests',
        message: error.message,
      });
    }

    if (opts.logErrors) {
      request.log.error(error);
    }

    const message = opts.hideInternalErrors ? 'An unexpected error occurred' : error.message;

    const statusCode = error.statusCode || 500;
    return reply.code(statusCode).send({
      statusCode,
      error: 'Internal Server Error',
      message,
    });
  };
}
