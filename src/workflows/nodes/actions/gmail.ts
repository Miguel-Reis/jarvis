import type { NodeDefinition } from '../registry.ts';

export const gmailAction: NodeDefinition = {
  type: 'action.gmail',
  label: 'Send Gmail',
  description: 'Send an email via Gmail using the Google API integration.',
  category: 'action',
  icon: '📨',
  color: '#3b82f6',
  configSchema: {
    to: {
      type: 'template',
      label: 'To',
      description: 'Recipient email address. Supports template expressions.',
      required: true,
      placeholder: 'user@example.com',
    },
    subject: {
      type: 'template',
      label: 'Subject',
      description: 'Email subject. Supports template expressions.',
      required: true,
      placeholder: 'Report from JARVIS',
    },
    body: {
      type: 'template',
      label: 'Body',
      description: 'Email body (plain text or HTML). Supports template expressions.',
      required: true,
      placeholder: 'Here is your report:\n\n{{data.content}}',
    },
  },
  inputs: ['default'],
  outputs: ['default'],
  execute: async (input, config, ctx) => {
    const to = String(config.to ?? '');
    const subject = String(config.subject ?? '');
    const body = String(config.body ?? '');

    ctx.logger.info(`Sending Gmail to ${to}: ${subject}`);

    // Delegate to the send_email tool if registered, otherwise placeholder
    let success = false;
    let note = '';
    if (ctx.toolRegistry.has('send_email')) {
      try {
        await ctx.toolRegistry.execute('send_email', { to, subject, body });
        success = true;
      } catch (err) {
        throw new Error(`Gmail send failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      note = 'Google API integration not configured — email not sent';
      ctx.logger.warn(note);
      success = false;
    }

    return {
      data: {
        ...input.data,
        gmail_sent: success,
        to,
        subject,
        note: note || undefined,
        sentAt: Date.now(),
      },
    };
  },
};
