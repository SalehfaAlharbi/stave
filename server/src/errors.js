/** An Error that Fastify turns into a response with the given status code. */
export function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}
