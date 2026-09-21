import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { BlockList, isIP } from 'node:net';

/**
 * Faixas publicadas em cloudflare.com/ips-v4 e /ips-v6 (lidas em 2026-09-21).
 * Mudam raramente; se o Cloudflare anunciar faixa nova, atualize aqui.
 */
const CLOUDFLARE_RANGES = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
  '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
];

const cloudflare = new BlockList();
for (const range of CLOUDFLARE_RANGES) {
  const [net, bits] = range.split('/');
  cloudflare.addSubnet(net, Number(bits), net.includes(':') ? 'ipv6' : 'ipv4');
}

/** "::ffff:1.2.3.4" é como o Node entrega IPv4 num socket dual-stack. */
function normalize(ip: string): string {
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

function isCloudflareEdge(ip: string | undefined): boolean {
  if (!ip) return false;
  const plain = normalize(ip);
  const version = isIP(plain);
  return version !== 0 && cloudflare.check(plain, version === 6 ? 'ipv6' : 'ipv4');
}

/**
 * Limite de requisições por IP real.
 *
 * Atrás do Cloudflare e do Traefik, o socket vê o IP da borda e todo mundo
 * cairia no mesmo balde. O Cloudflare entrega quem chamou em CF-Connecting-IP,
 * mas esse header só vale se quem conectou no Traefik for mesmo o Cloudflare:
 * batendo direto no IP da VPS, qualquer um inventaria um valor novo a cada
 * requisição e ganharia um balde novo toda vez. Fora da borda fica `req.ip`,
 * que com `trust proxy` é o IP que o Traefik viu conectar.
 */
@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Request): Promise<string> {
    const edge = req.ip;
    if (isCloudflareEdge(edge)) {
      const viaCloudflare = req.headers['cf-connecting-ip'];
      const ip = Array.isArray(viaCloudflare) ? viaCloudflare[0] : viaCloudflare;
      if (ip) return normalize(ip);
    }
    return edge ? normalize(edge) : 'desconhecido';
  }
}
