import { waitUntil } from '@vercel/functions';

export function retainBackgroundTask(task) {
  if (process.env.VERCEL) waitUntil(task);
}
