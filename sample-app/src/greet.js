import ms from 'ms';

export function greeting(serviceName) {
  return `hello, ${serviceName}`;
}

export function timeoutMs(setting) {
  return ms(setting);
}
