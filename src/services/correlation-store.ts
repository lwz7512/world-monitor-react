import type { ConvergenceCard, CorrelationDomain } from '@/services/correlation-engine';
import { getHydratedData } from '@/services/bootstrap';

type DomainCards = Record<CorrelationDomain, ConvergenceCard[]>;
type Subscriber = (domain: CorrelationDomain, cards: ConvergenceCard[]) => void;

function initFromBootstrap(): DomainCards {
  const bootstrap = (getHydratedData('correlationCards') as Record<string, ConvergenceCard[]>) ?? {};
  return {
    military: bootstrap['military'] ?? [],
    escalation: bootstrap['escalation'] ?? [],
    economic: bootstrap['economic'] ?? [],
    disaster: bootstrap['disaster'] ?? [],
  };
}

let _data: DomainCards | null = null;
const _subscribers = new Set<Subscriber>();

function getData(): DomainCards {
  if (!_data) _data = initFromBootstrap();
  return _data;
}

export function setCorrelationCards(domain: CorrelationDomain, cards: ConvergenceCard[]): void {
  getData()[domain] = cards;
  for (const cb of _subscribers) cb(domain, cards);
}

export function getCorrelationCards(domain: CorrelationDomain): ConvergenceCard[] {
  return getData()[domain];
}

export function subscribeCorrelationCards(cb: Subscriber): () => void {
  _subscribers.add(cb);
  return () => { _subscribers.delete(cb); };
}
