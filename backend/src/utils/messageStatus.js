const transitions = {
  queued: new Set(['sent', 'delivered', 'failed', 'expired']),
  sent: new Set(['delivered', 'failed']),
  delivered: new Set(),
  failed: new Set(['sent', 'delivered']),
  expired: new Set(),
};

export function canTransitionMessageStatus(current, next) {
  return current === next || Boolean(transitions[current]?.has(next));
}

export function assertMessageStatusTransition(current, next) {
  if (!canTransitionMessageStatus(current, next)) {
    const error = new Error(`Cannot change message status from ${current} to ${next}`);
    error.status = 409;
    throw error;
  }
}
