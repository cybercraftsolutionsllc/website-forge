/**
 * Config.js — Central configuration for WebsiteForge
 * 
 * Script Properties required:
 *   LLM_PROVIDER    — "openai" | "anthropic" | "gemini" | "xai"
 *   LLM_API_KEY     — API key for the chosen provider
 *   GITHUB_PAT      — GitHub Personal Access Token with repo scope
 *
 * Optional Script Properties:
 *   SHEET_ID        — override the default sheet ID
 *   LLM_MODEL       — override the default model for your provider
 *   AUTO_SEND_EMAIL — "true" to auto-send emails, "false" (default) for review-only
 *   PAYMENT_LINK    — Stripe/payment URL injected into emails
 *   SENDER_NAME     — Display name for outgoing Gmail (default: "CyberCraft Solutions")
 */

// Static constants
const CONFIG_ORG = 'cybercraftsolutionsllc';
const CONFIG_REPO = 'website-forge';
const CONFIG_BRANCH = 'main';
const DEFAULT_SHEET_ID = '1rP0SS64lhjP3ui3eV93e0PHnrhRb0OfHyj3IMZCKOp4';

const SUPPORTED_PROVIDERS = ['openai', 'anthropic', 'gemini', 'xai'];

const DEFAULT_MODELS = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-20250514',
  gemini: 'gemini-2.5-flash',
  xai: 'grok-3-mini-fast'
};

/**
 * Reads Script Properties and returns a validated config object.
 * Throws a user-friendly alert and returns null if anything is missing.
 */
function getConfig() {
  const props = PropertiesService.getScriptProperties();
  const provider = (props.getProperty('LLM_PROVIDER') || '').toLowerCase().trim();
  const apiKey = props.getProperty('LLM_API_KEY');
  const githubPat = props.getProperty('GITHUB_PAT');
  const sheetId = props.getProperty('SHEET_ID') || DEFAULT_SHEET_ID;
  const modelOverride = props.getProperty('LLM_MODEL');

  // Email config
  const autoSendEmail = (props.getProperty('AUTO_SEND_EMAIL') || '').toLowerCase().trim() === 'true';
  const paymentLink = props.getProperty('PAYMENT_LINK') || '';
  const senderName = props.getProperty('SENDER_NAME') || 'CyberCraft Solutions';

  const errors = [];

  if (!provider || !SUPPORTED_PROVIDERS.includes(provider)) {
    errors.push(`LLM_PROVIDER must be one of: ${SUPPORTED_PROVIDERS.join(', ')}. Got: "${provider || '(empty)'}"`);
  }

  if (!apiKey) {
    errors.push('LLM_API_KEY is not set. Add your API key in Script Properties.');
  }

  if (!githubPat) {
    errors.push('GITHUB_PAT is not set. Add a GitHub Personal Access Token with repo scope.');
  }

  if (errors.length > 0) {
    SpreadsheetApp.getUi().alert('⚠️ Configuration Error\n\n' + errors.join('\n\n'));
    return null;
  }

  return {
    provider: provider,
    apiKey: apiKey,
    model: modelOverride || DEFAULT_MODELS[provider],
    githubPat: githubPat,
    sheetId: sheetId,
    org: CONFIG_ORG,
    repo: CONFIG_REPO,
    branch: CONFIG_BRANCH,
    autoSendEmail: autoSendEmail,
    paymentLink: paymentLink,
    senderName: senderName
  };
}
