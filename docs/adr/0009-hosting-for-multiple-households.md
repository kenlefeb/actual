# 9. Hosting for multiple households

Fork-only; never upstream. **Status: Accepted** (2026-11-06, decided by Ken,
sc-2715). Usage was measured on 2026-11-07 (see "Measuring real usage"). This
ADR changes no production system; resizing the plan is a separate story.

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

Caps are ceilings, not use. Real use was measured on 2026-11-07 (sc-2715) and
is far below the caps; capacity figures below use the measurement.

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
they open no files. 3. Check the output. It is about 60 lines and must show `paste-ok-1` first and
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

### Result (measured on 2026-11-07, see sc-2715)

Ken ran the block above on 2026-11-07 at 00:28 UTC (comment 2754 on sc-2715).
The host had been up 20 days. Findings:

- **Host:** 1 vCPU, 3.9 GB RAM, no swap, 48 GB disk (25 percent used). About
  2.7 GB of RAM was available.
- **One household stack (production), peak memory since start:** Actual
  196 MiB, Tailscale 40 MiB, MCP 221 MiB, MCP Tailscale 19 MiB: about
  **0.47 GiB** in total (idle about 0.28 GiB), against 1.75 GiB of caps.
- **Shared overhead:** about 1.5 GB for the staging stack, Traefik and Lunch
  Money MCP, which are not households.
- **Stability:** no restarts and no OOM kills. Memory pressure was 0.
- **CPU is the constraint:** with one vCPU, CPU "some" pressure was 3.85
  percent over 5 minutes (12.85 percent over 10 seconds, partly the
  measurement itself).
- **Disk per household:** about 40 MB of data and about 105 MB of backups;
  not a constraint.

Capacity on the current KVM 1 (3.9 GB, 1 vCPU) is therefore 2 to 3 households
(memory alone would allow about 5; the single vCPU is the limit). A single
snapshot is not a month of history; re-run the block above before each plan
upgrade.

## Options

Prices are public list prices read from search results (several secondary
sources): AWS rates re-checked 2026-11-06, Hostinger renewal prices from
pricing reviews dated late October 2026. They move; re-check before
purchase. USD unless marked.

| Offer                                                             | Cost (2026-11-06)                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hostinger KVM 1 (today): 1 vCPU, 4 GB                             | $11.99/mo renewal ($6.49 on a 24-month intro)                                                                                                                                                                                                       |
| Hostinger KVM 2: 2 vCPU, 8 GB                                     | $14.99/mo renewal ($8.99 intro)                                                                                                                                                                                                                     |
| Hostinger KVM 4: 4 vCPU, 16 GB                                    | about $24.99 to $28.99/mo renewal (sources differ; $12.99 intro)                                                                                                                                                                                    |
| Hostinger KVM 8: 8 vCPU, 32 GB                                    | about $50/mo renewal (sources differ: $47.99 to $59.99)                                                                                                                                                                                             |
| Hetzner CX23: 2 vCPU, 4 GB                                        | about EUR 6/mo; CX33 (4 vCPU, 8 GB) about EUR 6.5 to 10. Prices rose in April and June 2026 and orders were restricted for a time: verify                                                                                                           |
| AWS Lightsail 4 GB / 8 GB                                         | $24 / $44 per month                                                                                                                                                                                                                                 |
| AWS EC2 t3.medium (2 vCPU, 4 GiB) / t3.large (2 vCPU, 8 GiB), x86 | about $0.0416/h (about $30/mo) / $0.0832/h (about $61/mo), us-east-1; plus EBS (gp3 about $0.08 per GB-month) and public IPv4 at $0.005/h. Graviton t4g.medium is $0.0336/h (about $24.5/mo) but needs an arm64 build, which the fork does not make |
| AWS Fargate                                                       | $0.04048 per vCPU-hour, $0.004445 per GB-hour (x86, us-east-1)                                                                                                                                                                                      |
| Amazon EKS                                                        | $0.10 per cluster-hour, about $73/mo, plus nodes; $0.60 per hour in extended support, about $438/mo (from month 15 of a Kubernetes version)                                                                                                         |
| Other managed Kubernetes (GKE, DigitalOcean)                      | search was inconclusive; verify. DigitalOcean's control plane has been free and GKE has had a monthly credit for one cluster, which would remove the EKS-style fixed fee                                                                            |

### A. Upgrade the single VPS

One bigger VPS (KVM 2 or KVM 4, same provider and console), every household a
Compose project from the template.

- **Cost per household.** On KVM 2 ($14.99/mo renewal), 6 to 8 households fit
  (memory allows more; 2 vCPUs are the limit): $14.99 / 8 = $1.87 to
  $14.99 / 4 = $3.75, so about $2 to $4. On today's KVM 1 ($11.99) with 3
  households: $11.99 / 3 = $4.00. On KVM 4 ($24.99 to $28.99) with 8:
  $3.12 to $3.62.
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

- **Cost per household (B1).** About $12 to $15 each (KVM 1 $11.99 to KVM 2
  $14.99), flat per household with no fixed pool to fill. Ken's own household keeps its VPS.
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

- **Cost per household.** C1: one t3.large (2 vCPU, 8 GiB; x86, because the
  fork builds amd64 only) holds the same 4 to 8 households as KVM 2.
  Per month: $0.0832 x 730 h = $60.74, plus 40 GB gp3 at $0.08 = $3.20, plus
  one public IPv4 at $0.005 x 730 h = $3.65, total $67.59. Per household:
  $67.59 / 8 = $8.45 to $67.59 / 4 = $16.90, so about $8 to $17.
  C2: Fargate bills per task. A household is two tasks (sync plus Tailscale,
  MCP plus Tailscale); measured peaks of 0.24 GiB each fit the smallest size
  (0.25 vCPU, 0.5 GB): (0.25 x $0.04048 + 0.5 x $0.004445) x 730 h = $9.01
  per task, $18.02 for two. Add 5 GB EBS ($0.40) and, if each household has
  its own public IPv4, $3.65: about $18 to $22. Allowing for larger task
  sizes, about $15 to $25. Tailscale adds nothing beyond container memory.
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

- **Cost per household.** EKS: $0.10 x 730 h = $73 control plane plus at
  least two t3.large nodes (2 x $60.74 = $121.48) is about $195/mo fixed.
  Per household: $195 / 2 = about $98 at 2, $195 / 10 = about $20 at 10, so
  about $20 to $98. A provider with a free control plane lowers the fixed
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

Monthly cost per household from the measurement (peak about 0.47 GiB per
household, 1.5 GB shared overhead). Arithmetic is in each option above.

| Option                               | Monthly cost per household | Basis                        |
| ------------------------------------ | -------------------------- | ---------------------------- |
| A. Current KVM 1, up to 3 households | $4.00 at 3                 | $11.99 / 3                   |
| A. KVM 2, 4 to 8 households          | about $2 to $4             | $14.99 / 8 to $14.99 / 4     |
| A. KVM 4, 8 households               | $3.12 to $3.62             | $24.99 to $28.99 / 8         |
| B1. VPS per household                | $12 to $15                 | KVM 1 $11.99 to KVM 2 $14.99 |
| C1. EC2 t3.large (4 to 8 households) | about $8 to $17            | $67.59 / 8 to $67.59 / 4     |
| C2. ECS Fargate                      | about $15 to $25           | two small tasks, EBS, IPv4   |
| D. EKS (2 to 10 households)          | about $20 to $98           | about $195 / 10 to $195 / 2  |

| Criterion                          | A. Bigger VPS            | B1. VPS per household     | C1. EC2                | C2. ECS Fargate  | D. Kubernetes (EKS)  |
| ---------------------------------- | ------------------------ | ------------------------- | ---------------------- | ---------------- | -------------------- |
| Isolation between households       | containers on one host   | separate VMs              | containers on one host | tasks, IAM       | pods on shared nodes |
| Operating effort for Ken           | lowest                   | grows with N              | like A plus AWS        | high             | highest              |
| Backups and restore                | existing timer, one disk | existing, per host        | EBS snapshots          | EBS snapshots    | CSI snapshots, new   |
| Fit with one-button deploys        | as is                    | host list, per-host trust | as is                  | rebuild approval | rebuild approval     |
| Custom domains, optional Tailscale | Traefik, after hardening | per host, simple          | ALB or Traefik         | ALB              | ingress              |

## Decision

Accepted by Ken on 2026-11-06 (sc-2715, comment 2755): **option A, a single
Hostinger VPS sized in steps.**

- **Now:** stay on the current KVM 1 (1 vCPU, 4 GB) while there are 3 or fewer
  households. Measured capacity is 2 to 3 households; the single vCPU is the
  limit.
- **Trigger:** before the 4th household goes live, upgrade the plan in place
  in hPanel to KVM 2 (2 vCPU, 8 GB, $14.99/mo at renewal). Capacity is about
  6 to 8 households, about $2 to $4 each.
- **Bigger step:** go to KVM 4 (4 vCPU, 16 GB) only if more than 8 households
  are expected within a year.
- **Escape hatch:** B1 (a VPS per household) stays available for a household
  that needs isolation from Ken's root. Keep the household template
  host-agnostic (sc-2716) so the move is a copy of one directory and its
  volume.
- **Rejected:** B1 as the default ($12 to $15 each), C1 EC2 ($8 to $17), C2
  Fargate ($15 to $25; SQLite does not suit shared network storage such as
  EFS) and EKS ($20 to $98), on cost and migration work.

Why option A: it is the cheapest per household and the only option that needs
no new trust model (signed deploy, forced command, backups and LOCKDOWN
checklist all exist), and it is the lowest operating load for one person.
Isolation stays container-level, as staging next to production is today.

Revisit when: peak memory reaches 70 percent of the host; CPU pressure stays
high on the current plan; more than 8 households; a household needs
separation from Ken's root; or an outage of the single VPS becomes
unacceptable (then C1 with EBS snapshots, or two VPSes with restore drills).

## Consequences

- sc-2716 to sc-2722 stay host-agnostic; sc-2717 loops over a household list
  on one host and reports per household.
- LOCKDOWN.md must cover root on one host reading every household; before a
  real second household, its text for that risk is rewritten for it.
- Plan upgrades follow the decision above. Resizing KVM 1 to KVM 2 is Ken's
  production change (separate story); re-run the measurement block first and
  after.
- Provider prices moved several times in 2026 (Hetzner in April and June;
  Hostinger renewal is about double the intro rate). Re-check list prices
  before purchase.
- Follow-up for the Product Owner: an optional recurring read-only usage
  verb, and the plan-upgrade story that triggers before the 4th household.

## Sources (read 2026-11-06; Hostinger reviews late October 2026)

Hostinger VPS pricing: hostinger.com/vps-hosting (search snippet) and
hostadvice.com's Hostinger VPS pricing. Hetzner 2026 repricing: northflank.com
and betterstack.com reviews. EKS and Fargate rates: AWS pricing as quoted by
komodor.com and cloudburn.io. EC2 t3 (x86) rates: $0.0416/h and $0.0832/h, us-east-1; EBS gp3 $0.08 per GB-month; public IPv4 $0.005/h; Fargate and EKS rates re-verified by web search 2026-11-06. Lightsail bundles: AWS Lightsail documentation. All are secondary
readings of provider prices.
