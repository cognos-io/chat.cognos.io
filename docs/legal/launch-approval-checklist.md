# Legal launch approval checklist

**Status:** External launch gate  
**Last reviewed:** 10 July 2026

This checklist separates repository documentation from approvals that code cannot prove. A checked
repository item is not legal approval. The production service must not launch until the accountable
owner records evidence for every external item below.

## Public material

- [ ] Swiss/EU privacy counsel approves the Privacy Policy, Terms, age threshold, legal bases,
  controller disclosures, rights process, and international-transfer wording for the launch market.
- [ ] Counsel confirms whether Climacrux GmbH needs an EU representative, UK representative, Data
  Protection Officer, or other local contact; publish required details before serving that market.
- [ ] The production owner compares deployed services and regions with the public Privacy, Security,
  and Subprocessors pages and records the comparison date.
- [ ] All six public language versions receive legal/translation approval; their JSON key structure,
  links, dates, and material meaning remain equivalent.

## Providers and transfers

- [ ] Execute and retain required data-processing terms with every production Provider, including
      hosting, CDN/DNS, backup, email, billing, analytics, AI gateway, and underlying AI model
      Providers.
- [ ] For each Provider, record its legal entity, role, data categories, processing and support
  locations, subprocessors, retention/deletion behaviour, breach terms, and termination deletion.
- [ ] Counsel approves the transfer mechanism for every route outside Switzerland and the EEA,
  including any required clauses, addenda, or transfer-risk assessment.
- [ ] Confirm in contract and effective Provider configuration that live AI requests are not used
  for model training and Provider retention is disabled. Preserve dated evidence for each model
  route; disable any route that cannot meet both conditions.
- [ ] Confirm Paddle's controller/processor roles, checkout disclosures, cookies, tax-record
  retention, and international transfers against the production agreement and configuration.

## Retention and rights operations

- [ ] Record production retention and deletion for application logs, security events, support mail,
  billing records, deleted-record snapshots, attachments, and every backup tier. Reconcile each
  value with the public policy.
- [ ] Run and record account deletion, export, correction, objection/restriction, consent
      withdrawal, and verified privacy-request procedures, including data held by Providers.
- [ ] Run and record a backup-expiry/restore test demonstrating the stated lifecycle without
      exposing an Account Key or message content.

## Approval record

The launch record must identify the accountable business owner, counsel/reviewer, approval date,
approved markets, approved Provider/model routes, policy revision, and links to contract and
configuration evidence. Store confidential evidence outside this public repository and link only to
its controlled location.
