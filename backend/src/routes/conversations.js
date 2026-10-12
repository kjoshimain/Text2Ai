import express from 'express';
import { listConversations, listMessages, getConversation } from '../services/store/memory.js';

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ conversations: listConversations() });
});

router.get('/:id', (req, res) => {
  const conversation = getConversation(req.params.id);
  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  res.json({ conversation, messages: listMessages(conversation.id) });
});

export default router;
