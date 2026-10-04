# Vydávání InitPad Agenta

Release Agenta vzniká pouze z verzovacího tagu. Workflow sestaví jeden OCI index
pro Linux `amd64` a `arm64`, připojí SBOM z BuildKitu a maximální provenance,
podepíše immutable digest a release soubory pomocí keyless Cosign a vytvoří
GitHub prerelease. Nikdy nepublikuje měnitelný tag image `latest`. Release se
povýší na stable teprve po živé acceptance na hostu.

## Publikace

1. Změňte verzi v `apps/agent/package.json`, `apps/agent/src/types.ts` a v
   labelu verze OCI v `apps/agent/Dockerfile`. Spusťte `npm run check:release` a
   změnu commitněte.
2. Vytvořte a odešlete anotovaný tag, který přesně odpovídá verzi:

   ```sh
   version=$(node -p "require('./apps/agent/package.json').version")
   git tag -a "agent-v${version}" -m "InitPad Agent ${version}"
   git push origin "agent-v${version}"
   ```

   Chraňte vzor tagů `agent-v*`, aby je mohli vytvářet nebo měnit pouze správci
   releasů. Publikovaný release tag nikdy nepřesouvejte.

3. Workflow **Release InitPad Agent** před sestavením odmítne neodpovídající tag
   i již existující verzovací tag. Podepsaný výsledek publikuje jako GitHub
   prerelease, aby výchozí stable katalog nemohl zákaznickým instalacím nabídnout
   runtime, který neprošel acceptance.
4. Dokud je kandidát prerelease, proveďte jeho audit:

   ```sh
   npm run audit:public-release -- --tag "agent-v${version}" --allow-prerelease
   ```

5. Na disposable acceptance control plane nastavte
   `INITPAD_AGENT_UPDATE_CHANNEL=candidate`, restartujte API a postupujte podle
   [`ACCEPTANCE.md`](./ACCEPTANCE.md). UI tento kanál výslovně označuje. Stable
   instalace ponechávají výchozí hodnotu `stable` a prerelease ignorují.
6. Po splnění všech požadovaných živých kontrol povyšte existující release bez
   opětovného sestavení a bez přesouvání jeho tagu:

   ```sh
   gh release edit "agent-v${version}" --prerelease=false --latest
   npm run audit:public-release -- --tag "agent-v${version}"
   ```

   Poté aktualizujte `deploy/agent-release.env` z podepsaného manifestu a
   zahrňte tuto zkontrolovanou bootstrap dvojici do dalšího releasu platformy.
   Existující Agenti nově stabilní release objeví přes podepsaný katalog.
   Provozovatelé neupravují `.env` při každé aktualizaci Agenta.

Pro anonymní zákaznickou instalaci musí být balíček GHCR veřejný. Po jeho první
publikaci změňte viditelnost balíčku jednorázově v GitHub Packages. Tento krok
nelze bezpečně automatizovat a GitHub upozorňuje, že změnu balíčku na veřejný
nelze vrátit zpět. Zdrojový repozitář může zůstat privátní. Identita podpisu
image záměrně nadále uvádí jeho repozitář a workflow.

GitHub artifact attestations se u veřejných repozitářů přidávají automaticky.
Pro privátní repozitář GitHub Enterprise Cloud nastavte proměnnou repozitáře
`INITPAD_ENABLE_PRIVATE_ATTESTATIONS=true`. Standardní privátní repozitáře
Free, Pro a Team GitHub artifact attestations nepodporují, takže Cosign zůstává
ve všech případech přenositelným podpisem releasu.

## Ověření

Zástupné hodnoty nahraďte hodnotami releasu:

```sh
TAG=agent-vX.Y.Z
cosign verify \
  --certificate-identity "https://github.com/OWNER/REPOSITORY/.github/workflows/release-agent.yml@refs/tags/${TAG}" \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  'ghcr.io/OWNER/initpad-agent@sha256:DIGEST'
```

Stáhněte release assets do jednoho adresáře a poté ověřte jejich checksumy a
podpis checksumů:

```sh
TAG=agent-vX.Y.Z
sha256sum --check SHA256SUMS
cosign verify-blob \
  --bundle SHA256SUMS.sigstore.json \
  --certificate-identity "https://github.com/OWNER/REPOSITORY/.github/workflows/release-agent.yml@refs/tags/${TAG}" \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  SHA256SUMS
```

Podepsaný release obsahuje také `initpad-agent-host-acceptance.sh`. Před
zkopírováním na disposable host Agenta jej ověřte prostřednictvím stejného
souboru `SHA256SUMS`. Skript poskytuje nedestruktivní checkpointy s důkazy o
odpojení a opětovném připojení, které popisuje `ACCEPTANCE.md`.

SBOM image je zároveň release asset i přílohou OCI image. Platformově specifický
dokument SPDX si lze prohlédnout bez stažení image:

```sh
docker buildx imagetools inspect 'ghcr.io/OWNER/initpad-agent@sha256:DIGEST' \
  --format '{{ json (index .SBOM "linux/amd64").SPDX }}'
```

Publikace prerelease není výsledkem acceptance. Před schválením releasu pro
produkci postupujte podle reprodukovatelného clean-host runbooku
[`ACCEPTANCE.md`](./ACCEPTANCE.md). Ověřuje první enrollment, restart po
restartu hostu, idempotentní přeinstalaci, rollback ze záměrně nezdravého
digestu a zachování existujících workloadů při odpojení Agenta. Skutečný
checkpoint aktualizace se uzavře až po vydání pozdějšího podepsaného releasu.

Pro checkpoint restartu spusťte příkaz `before-reboot` z release assetu před
restartem hostu a `after-reboot` po přihlášení. Dvojice odmítne zakázanou službu
Dockeru v systemd, nesprávnou restart policy, náhradu kontejneru i změněnou
identitu targetu, takže se nespoléhá na vizuální pozorování stavu online nebo
offline.
