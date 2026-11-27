// Évalue des réponses HTTP PostgREST BRUTES avec le contrat mobile (validateurs d'exécution et errorFromPostgrest).
// Entrée (stdin) : [{ id, kind: 'funds_snapshot' | 'envelope_snapshot' | 'error', text }] — `text` = corps HTTP tel que reçu.
// Usage : node eval_contract.ts <dossier du contrat v3>
const dir = process.argv[2];
const { validateSqlFundsSnapshot, validateSqlEnvelopeSnapshot } = await import(`${dir}/envelopeMapper.ts`);
const { errorFromPostgrest, PUBLIC_MESSAGES } = await import(`${dir}/duoBackend.contract.ts`);
const chunks: Buffer[] = []; for await (const c of process.stdin) chunks.push(c as Buffer);
const items = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const out = items.map((it: { id: string; kind: string; text: string }) => {
  try {
    const body = JSON.parse(it.text);                      // JSON.parse : un nombre JSON serait déjà arrondi ici, d'où le refus du validateur
    if (it.kind === 'error') {
      const e = errorFromPostgrest(body);
      return { id: it.id, code: e.code, message: e.message, public: e.message === PUBLIC_MESSAGES[e.code], fuite: /duo_v3_|constraint|violates|domain/i.test(e.message) };
    }
    (it.kind === 'funds_snapshot' ? validateSqlFundsSnapshot : validateSqlEnvelopeSnapshot)(body);
    return { id: it.id, valid: true };
  } catch (e: any) { return { id: it.id, valid: false, code: e?.code ?? 'EXCEPTION', detail: e?.detail ?? String(e).slice(0, 160) }; }
});
process.stdout.write(JSON.stringify(out));
