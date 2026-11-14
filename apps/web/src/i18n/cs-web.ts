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
  // pages/Infrastructure.tsx (return to form)
  'Your form is saved': 'Formulář je uložený',
  'Add the server here, then go back — everything you filled in is kept.':
    'Tady server přidejte a pak se vraťte — vše, co jste vyplnili, zůstane zachované.',
  'Back to the form': 'Zpět na formulář',
  // pages/NewProject.tsx
  'Setting up the project takes longer than usual. It continues in the background — follow it on the overview.':
    'Zakládání projektu trvá déle než obvykle. Pokračuje na pozadí — sledujte ho na přehledu.',
  // pages/ImportRepo.tsx
  'The import takes longer than usual. It continues in the background — follow it on the overview.':
    'Import trvá déle než obvykle. Pokračuje na pozadí — sledujte ho na přehledu.',
  'Import lists repositories that InitPad can reach and that are not connected yet. An empty repository needs a first commit. To start without a repository, <link>create a project from a template</link>.':
    'Import nabízí repozitáře, ke kterým má InitPad přístup a které ještě nejsou připojené. Prázdný repozitář potřebuje první commit. Pokud repozitář nemáte, <link>založte projekt ze šablony</link>.',
  // components/organisms/EnvVarsDialog.tsx
  'Could not load the variables': 'Proměnné se nepodařilo načíst',
  'Saved — not applied yet': 'Uloženo — zatím se neprojevilo',
  'Request redeploy of {env}': 'Požádat o znovunasazení {env}',
  'Redeploy {env}': 'Znovu nasadit {env}',
  'The running application uses the new values after the next deployment.':
    'Běžící aplikace použije nové hodnoty po dalším nasazení.',
  'Edit {key}': 'Upravit {key}',
  // pending production approvals (Dashboard, Projects, Sidebar)
  'Review production requests': 'Posuďte žádosti o produkci',
  'Show production requests waiting for approval ({count})':
    'Zobrazit žádosti o produkci čekající na schválení ({count})',
  'Projects waiting for production approval': 'Projekty čekající na schválení produkce',
  'Show all projects': 'Zobrazit všechny projekty',
  'Open a project to review its production request.':
    'Žádost o produkci posoudíte v detailu projektu.',
  'Nothing waits for approval': 'Nic nečeká na schválení',
  'No production request in this workspace needs a review.':
    'V tomto workspace žádná žádost o produkci nečeká na posouzení.',
  'production requests waiting for approval': 'žádostí o produkci čeká na schválení',
  // pages/Projects.tsx
  'Production requests wait for approval ({count}).':
    'Žádosti o produkci čekají na schválení ({count}).',
  'Show those projects': 'Zobrazit tyto projekty',
  // lib/request-id.ts
  'Secure random number generation is not available in this browser':
    'Tento prohlížeč neumí bezpečně generovat náhodná čísla',
  // help links
  Troubleshooting: 'Řešení potíží',
} satisfies Record<string, string>;
