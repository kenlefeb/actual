# 9. Hosting for multiple households

Fork-only; never upstream. **Status: Proposed** (2026-11-06, sc-2715). Ken
decides; nothing here changes production. Numbers marked **PENDING** wait for
the usage measurement in "Measuring real usage".

## Context

Ken wants several households, each on its own server stack (sc-2702: a sync
server, hosted MCP, two Tailscale sidecars, backups and an Auth0 app pair per
household, all provisioned from one template). Decided on sc-2702: households
reach their server over Tailscale node sharing now and by custom domain later;
each household's lead administers that household's server; Ken runs the shared
plumbing (host, Auth0 tenant, deploys). The host is undecided.

Today's host is one Hostinger VPS: 1 vCPU, about 4 GiB RAM, 41 GiB free disk
(`actual-hosting/README.md`). It runs staging, production, both MCPs, Traefik
and Lunch Money MCP. Memory caps in the compose files, per household stack:

| Container                | Cap                                                 |
| ------------------------ | --------------------------------------------------- |
| sync server              | 768 MiB                                             |
| Tailscale sidecar (sync) | 256 MiB                                             |
| hosted MCP               | 512 MiB                                             |
| MCP sidecar              | 256 MiB                                             |
| **Total**                | **1,792 MiB (about 1.75 GiB)**; CPU caps 0.75 + 0.5 |

Caps are ceilings, not use. Nobody has measured real use, so every capacity
figure below is computed from caps (conservative) and flagged PENDING.

Two constraints from the code shape every option:

- Actual stores budgets in SQLite files. The data volume must be local block
  storage on one host. A network filesystem (NFS, EFS) is a risk for SQLite
  locking and is excluded.
- Production deploys are one button: GitHub Actions starts the run, Ken's
  Touch ID signature approves it, and a root-owned forced command on the VPS
  verifies the signature (`production/deploy-command.py`). Any host must fit
  that shape: one signed approval, verified on the host.

## Measuring real usage

**Approach: a step Ken runs (not a GitHub Actions job).** The existing deploy
workflow only SSHes in with two forced-command keys that accept `staging RUN`
and `production RUN ...`. A read-only job would need a new verb in
`deploy-command.py`, a root-owned file only Ken installs, so it costs Ken a
console session either way. Agents may not read production, so Ken runs this
once, read-only, and pastes the output on sc-2715.

Ken's steps (sc-2715 carries the same text). The block only reads: it restarts
nothing, writes no file, and prints no budget data or secrets (container
names, percentages and sizes only). It is safe to re-run.

1. Open the Hostinger Web console: hPanel, VPS, money.kenlefeb.cloud, Overview,
   VPS information, Web console. It opens a root shell on the VPS.
   _Why you, not an agent:_ it is root on the production host under your
   Hostinger login, and agents must not connect to production.
2. Click the copy button on the block below (do not retype it) and paste it
   into the console as one paste. It starts with `echo paste-ok-1`. Wait for
   the prompt to come back before doing anything else (about 10 seconds).

```sh
echo paste-ok-1; date -u; uptime; nproc; free -m; df -h /
echo "--- docker stats (name, cpu, mem, limit)"
docker stats --no-stream --format '{{.Name}} cpu={{.CPUPerc}} mem={{.MemUsage}} {{.MemPerc}}'
echo "--- peak memory since container start, restarts, OOM kills"
for id in $(docker ps -q); do
  n=$(docker inspect --format '{{.Name}} restarts={{.RestartCount}} oom={{.State.OOMKilled}} started={{.State.StartedAt}}' $id)
  full=$(docker inspect --format '{{.Id}}' $id)
  p=$(cat /sys/fs/cgroup/system.slice/docker-$full.scope/memory.peak 2>/dev/null || echo n/a)
  echo "$n peak_bytes=$p"
done
echo "--- disk by Docker volume and backup directory (sizes only)"
du -sh /var/lib/docker/volumes/*/_data 2>/dev/null
du -sh /opt/actual-*/backups 2>/dev/null
du -sh /docker/money 2>/dev/null
docker system df
echo "--- memory and CPU pressure"
cat /proc/pressure/memory /proc/pressure/cpu 2>/dev/null
```

   The `du` lines print only a size and a path (Docker volume names, backup
   directories and `/docker/money`, which holds Lunch Money MCP and Traefik);
   they open no files.
3. Check the output. It is about 60 lines and must show `paste-ok-1` first and
   these four headings, each followed by lines like these (values are
   examples):

   ```text
   --- docker stats (name, cpu, mem, limit)
   actual-production-actual-1 cpu=0.40% mem=210MiB / 768MiB 27.34%
   --- peak memory since container start, restarts, OOM kills
   /actual-production-actual-1 restarts=0 oom=false started=2026-11-01T03:10:00Z peak_bytes=268435456
   --- disk by Docker volume and backup directory (sizes only)
   1.2G	/var/lib/docker/volumes/actual-production_data/_data
   --- memory and CPU pressure
   some avg10=0.00 avg60=0.00 avg300=0.00 total=123456
   ```

   If the output differs:
   - `peak_bytes=n/a`: the host uses cgroup v1 or an older kernel. Fine; paste
     it anyway and say so. Do not try to fix it.
   - `command not found` or `permission denied`: you are not in the root
     console, or Docker is not running. Stop, do not run anything else, and
     comment what the line said.
   - A heading with nothing under it (for example no pressure lines on an old
     kernel): paste it as is and say which section was empty.
4. Copy the whole output and paste it into a comment on
   https://app.shortcut.com/blacksmith-press/story/2715.
   Never paste anything else from the console; if any line shows a password,
   key or token, stop and do not paste (none is expected).

A single snapshot shows load now and the peak since each container started
(`memory.peak`), not a month of history. If a peak is near a cap or
`oom=true` appears, say so on the story: that outweighs every estimate below.
A recurring read-only `usage` verb is a possible follow-up, not part of this
decision.

Measured usage per stack: **PENDING** (sync server, Tailscale, MCP, MCP
sidecar, backups on disk). Placeholder for planning only: 40 percent of caps,
about 0.7 GiB per household.

## Options

Prices are public list prices read on 2026-11-06 from search results (several
secondary sources). They move, and the ones marked verify need checking on the
provider's page before Ken commits. USD unless marked.

| Offer                                        | Cost (2026-11-06)                                                                                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hostinger KVM 1 (today): 1 vCPU, 4 GB        | $11.99/mo renewal ($6.49 on a 24-month intro)                                                                                                                            |
| Hostinger KVM 2: 2 vCPU, 8 GB                | $14.99/mo renewal ($8.99 intro)                                                                                                                                          |
| Hostinger KVM 4: 4 vCPU, 16 GB               | $28.99/mo renewal ($12.99 intro)                                                                                                                                         |
| Hostinger KVM 8: 8 vCPU, 32 GB               | about $50/mo renewal (sources differ: $47.99 to $59.99)                                                                                                                  |
| Hetzner CX23: 2 vCPU, 4 GB                   | about EUR 6/mo; CX33 (4 vCPU, 8 GB) about EUR 6.5 to 10. Prices rose in April and June 2026 and orders were restricted for a time: verify                                |
| AWS Lightsail 4 GB / 8 GB                    | $24 / $44 per month                                                                                                                                                      |
| AWS EC2 t3.medium (2 vCPU, 4 GiB) / t3.large (2 vCPU, 8 GiB), x86 | about $0.0416/h (about $30/mo) / $0.0832/h (about $61/mo), us-east-1 (verify); plus EBS (gp3 about $0.08 per GB-month) and public IPv4 at $0.005/h. Graviton t4g.medium is $0.0336/h (about $24.5/mo) but needs an arm64 build, which the fork does not make |
| AWS Fargate                                  | $0.04048 per vCPU-hour, $0.004445 per GB-hour (x86, us-east-1)                                                                                                           |
| Amazon EKS                                   | $0.10 per cluster-hour, about $73/mo, plus nodes; $0.60 per hour in extended support, about $438/mo (from month 15 of a Kubernetes version)                              |
| Other managed Kubernetes (GKE, DigitalOcean) | search was inconclusive; verify. DigitalOcean's control plane has been free and GKE has had a monthly credit for one cluster, which would remove the EKS-style fixed fee |

### A. Upgrade the single VPS

One bigger VPS (KVM 2 or KVM 4, same provider and console), every household a
Compose project from the template.

- **Cost per household.** By caps, KVM 2 (8 GB) holds production plus about one
  more household beside staging; KVM 4 (16 GB) holds about 6 to 7. At 4
  households on KVM 4: $28.99 / 4 = about $7. At 2 households on KVM 2:
  about $7.50. PENDING: measured use could roughly double these counts.
- **Isolation.** Separate containers, volumes, networks and Tailscale nodes per
  household. Root on the VPS (Ken) can read every household, and so can
  anything that compromises the host. A noisy household can slow the others
  (shared CPU and disk) unless the compose CPU and memory caps hold.
- **Operating effort.** Lowest: the host, console, forced command, signed
  deploy and backups already exist. The cost is a household template (sc-2716)
  and a deploy loop (sc-2717).
- **Backups and restore.** The existing snapshot timer and age encryption, per
  household volume. A host failure loses every household until restored from
  the off-site copy (RESTORE.md already covers it).
- **One-button deploys.** Fits as is: Ken runs `scripts/deploy_prod.py` on his
  Mac, which signs the approval (Touch ID) and starts the workflow; the VPS
  forced command verifies that signature. One host, one verification. The loop must stop on the first failing household and report each.
- **Custom domains and optional Tailscale.** Traefik already runs on the host
  and can route a hostname per household with ACME certificates; the Tailscale
  sidecar becomes optional per household. Needs the pre-release hardening
  first (today port 22 is open to the internet and `ufw` is inactive, per LOCKDOWN.md; no public HTTP route exists).

### B. Several VPSes

B1: one VPS per household (for example Hetzner CX23 or Hostinger KVM 2).
B2: a few households per VPS, which is option A repeated.

- **Cost per household (B1).** About $7 to $15 each (CX23 to KVM 2), flat per
  household with no fixed pool to fill. Ken's own household keeps its VPS.
- **Isolation.** Strongest practical: separate kernels, disks and root. A
  compromise of one VPS exposes one household. Ken still holds root on all.
- **Operating effort.** Grows with N: N OS patch cycles, N firewall and SSH
  postures, N provider logins, N LOCKDOWN checklists.
- **Backups and restore.** Per-host timer, per-household blast radius. The
  restore drill is per host; the scripts are the same.
- **One-button deploys.** The signed approval and forced command exist once
  per host. Fan-out needs a host list, a deploy key and an `allowed_signers`
  file installed on each new host by Ken, once. One host's failure is isolated.
- **Custom domains.** Straightforward: each host has its own public IP and
  Traefik. Provisioning a household means buying a VPS, so "one workflow"
  (sc-2721) needs the provider's API and a billing step.

### C. Containers on AWS (EC2, or ECS)

C1: EC2 (t3.large or similar x86) running the same Compose projects.
C2: ECS on Fargate, one service per container, an EBS volume per task.

- **Cost per household.** C1: one t3.large (x86; the fork builds amd64 only,
  so Graviton t4g would need an arm64 build) at about $61/mo plus EBS and IPv4
  is about $69/mo and holds 2 to 3 households by caps, so about $23 to $35
  each, notably more than option A. C2: a sync task (0.5 vCPU, 1 GB) plus an MCP task is about
  $18 + $18 = $36, plus EBS and IPv4, so about $45 per household. PENDING:
  smaller measured use lowers Fargate task sizes and cost proportionally.
- **Isolation.** C2 gives per-household IAM roles, security groups and task
  boundaries, with no shared root. C1 equals option A on a larger bill.
- **Operating effort.** C1 is option A plus a new cloud account (IAM, VPC,
  billing alarms). C2 rewrites the compose stack into task definitions, adds
  EBS volume lifecycle, and runs Tailscale in userspace mode (Fargate allows
  no privileged containers). EFS is not an option for SQLite (see Context).
- **Backups and restore.** EBS snapshots (native, schedulable, cross-region)
  plus the existing age-encrypted export. Better than a single VPS disk.
- **One-button deploys.** C1 reuses the same flow: Ken's `deploy_prod.py` signs and
  dispatches the workflow, and the forced command on the instance verifies it. C2
  replaces the host-side check with `ecs update-service` from Actions using OIDC; the Touch ID
  signature check would have to be rebuilt as an approval step, a security
  design task of its own.
- **Custom domains.** Natural: ALB or Route 53 plus ACME or ACM.

### D. Kubernetes (EKS, or GKE or DigitalOcean)

- **Cost per household.** EKS: $73 control plane plus at least two x86 t3.large
  nodes (about $122) is about $195/mo fixed. Per household: about $98 at 2,
  $49 at 4, $39 at 5, $20 at 10. A provider with a free control plane lowers the fixed
  part; verify.
- **Isolation.** A namespace, NetworkPolicy and PodSecurity per household is
  good isolation by configuration, but pods share nodes and one control
  plane; more to get wrong than separate VMs.
- **Operating effort.** Highest by far for one operator: cluster upgrades every
  few months (EKS bills $438/mo if a version lapses into extended support),
  ingress, certificates, CSI volumes, node patching, a Tailscale operator.
  Everything the template does would be re-expressed as Helm or manifests.
- **Backups and restore.** Volume snapshots plus the export job, both new work.
- **One-button deploys.** Fits GitOps well once built; the signed approval and
  Touch ID check need rebuilding, as in C2.
- **Custom domains.** The strongest model (an ingress per household), at the
  cost above.
- Justified only when households number in the dozens or Ken wants
  autoscaling and per-household SLAs. At 1 to 10 households it is cost and
  effort with no benefit Ken has asked for.

## Comparison

Cost per household at 4 households, caps-based (PENDING), except C1, which holds only 2 to 3 households per instance by the same caps (its figure is at that capacity).

| Criterion                          | A. Bigger VPS            | B1. VPS per household     | C1. EC2                | C2. ECS Fargate  | D. Kubernetes (EKS)  |
| ---------------------------------- | ------------------------ | ------------------------- | ---------------------- | ---------------- | -------------------- |
| Monthly cost per household         | about $7 (KVM 4)         | $7 to $15                 | $23 to $35             | about $45        | about $49            |
| Isolation between households       | containers on one host   | separate VMs              | containers on one host | tasks, IAM       | pods on shared nodes |
| Operating effort for Ken           | lowest                   | grows with N              | like A plus AWS        | high             | highest              |
| Backups and restore                | existing timer, one disk | existing, per host        | EBS snapshots          | EBS snapshots    | CSI snapshots, new   |
| Fit with one-button deploys        | as is                    | host list, per-host trust | as is                  | rebuild approval | rebuild approval     |
| Custom domains, optional Tailscale | Traefik, after hardening | per host, simple          | ALB or Traefik         | ALB              | ingress              |

## Decision (proposed)

**Option A: upgrade the single VPS**, sized from the measurement (KVM 4, 16 GB,
4 vCPU, is the current guess), with households as template-driven Compose
projects. Keep the household template host-agnostic (sc-2716) so a household
can move to its own VPS (option B1) without redesign.

Why:

- It is the cheapest per household by a factor of about 3 and the only option
  that needs no new trust model: the signed deploy, forced command, backups
  and LOCKDOWN checklist all exist.
- It is the lowest operating load for one person. Ken's roles (runs the
  plumbing; household leads run their own servers) do not need Kubernetes-scale
  tooling.
- Isolation stays container-level, the same as staging next to production
  today. If a household needs stronger separation, B1 is the escape hatch and
  the template makes the move a copy of one directory and its volume.

Revisit when any of these happens: measured peak memory reaches 70 percent of
the host; more than about 6 households; a household needs separation from
Ken's root; or an outage of the single VPS becomes unacceptable (then C1 with
EBS snapshots, or two VPSes with restore drills).

## Consequences

- sc-2716 to sc-2722 stay host-agnostic; sc-2717 loops over a household list
  on one host and reports per household.
- LOCKDOWN.md must cover root on one host reading every household; before a
  real second household, its text for that risk is rewritten for it.
- Until the measurement lands, KVM 2 versus KVM 4 stays open and cost per
  household uses caps. If the measurement shows peak use above about 1 GiB per
  household, size to KVM 8 or choose B1.
- Provider prices moved several times in 2026 (Hetzner in April and June;
  Hostinger renewal is about double the intro rate). Re-check list prices
  before purchase.
- Follow-ups for the Product Owner: an optional recurring read-only usage
  verb, and a re-run of this ADR's cost table once the measurement is in.

## Sources (read 2026-11-06)

Hostinger VPS pricing: hostinger.com/vps-hosting (search snippet) and
hostadvice.com's Hostinger VPS pricing. Hetzner 2026 repricing: northflank.com
and betterstack.com reviews. EKS and Fargate rates: AWS pricing as quoted by
komodor.com and cloudburn.io. EC2 t3 (x86) rates: AWS on-demand list prices recalled, verify. Lightsail bundles: AWS Lightsail documentation. All are secondary
readings of provider prices.
