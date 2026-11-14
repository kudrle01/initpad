/**
 * Czech messages added by the web audit fixes (ADR-185), grouped by file.
 */
export const csWeb = {
  // toast.tsx
  'Dismiss notification': 'Zavřít oznámení',
  // components/organisms/TargetDialog.tsx
  'Docker server with the Agent': 'Docker server s Agentem',
  'A Docker server with the Agent is added by a workspace owner or admin, because only they can connect the Agent. You can add and verify an SFTP server here and deploy to every server this workspace already uses.':
    'Docker server s Agentem přidá owner nebo admin workspace, protože jen oni mohou Agenta připojit. Vy tu můžete přidat a ověřit SFTP server a nasazovat na všechny servery, které workspace už používá.',
  // components/organisms/infrastructure/TargetRow.tsx
  'The Agent is not connected yet': 'Agent zatím není připojený',
  'A Docker server with the Agent is added and connected by a workspace owner or admin. Ask one of them to finish the Agent setup; until then this server cannot receive deployments.':
    'Docker server s Agentem přidá a připojí owner nebo admin workspace. Požádejte některého z nich o dokončení nastavení Agenta; do té doby na tento server nejde nasazovat.',
  // pages/Infrastructure.tsx
  'Close the Agent setup?': 'Zavřít nastavení Agenta?',
  'The enrollment command is shown only now. If the server has not run it yet, you will have to create a new one.':
    'Registrační příkaz se zobrazuje jen teď. Pokud ho server ještě nespustil, budete muset vytvořit nový.',
  'Close setup': 'Zavřít nastavení',
} satisfies Record<string, string>;
