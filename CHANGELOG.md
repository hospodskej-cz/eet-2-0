# Changelog

## [0.2.0](https://github.com/hospodskej-cz/eet-2-0/compare/v0.1.0...v0.2.0) (2026-10-28)


### Features

* **clients:** C# client for the HTTP API v1 ([4c14a96](https://github.com/hospodskej-cz/eet-2-0/commit/4c14a96ad2e4f996f1eadac2f7023264fe223e15))
* **clients:** drift guard, CI workflow and documentation ([70f3ac6](https://github.com/hospodskej-cz/eet-2-0/commit/70f3ac67ddc2e79337f0be6a7e7fce24f01ee0dd))
* **clients:** PHP client for the HTTP API v1 ([ae8f4cc](https://github.com/hospodskej-cz/eet-2-0/commit/ae8f4cc7511c5545137f99f2ae3743b50c2e8079))
* **clients:** Python client for the HTTP API v1 ([08ce35a](https://github.com/hospodskej-cz/eet-2-0/commit/08ce35a9680c7eee5501aad8b53f68feb9edafe0))


### Bug Fixes

* **clients:** PHP fake server keeps 202 with Location; count assertions in the error test ([288fdd1](https://github.com/hospodskej-cz/eet-2-0/commit/288fdd118761c6094cc76f7da11ca928fb2cf92d))
* **core:** bind answers to the request and harden the transport ([1d26134](https://github.com/hospodskej-cz/eet-2-0/commit/1d26134e400da6abe32a7d4482119a91c11ed407))
* **core:** harden DER/X.509 reader and response signer checks ([fd80720](https://github.com/hospodskej-cz/eet-2-0/commit/fd8072013ff9f4f27882249b9296d25e9a415e20))


### Documentation

* add code of conduct, support, governance, issue forms and PR template ([943a3d3](https://github.com/hospodskej-cz/eet-2-0/commit/943a3d35757fc6dca1e24795dec94a364fa79791))
* add ROADMAP and STABILITY ([4f3857e](https://github.com/hospodskej-cz/eet-2-0/commit/4f3857ef8b7d8f564b311bfd15a1e696be8aac2d))
* **adr:** ADR-004 keep, pin and monitor @finitoapp/eet-client ([6d3c4d1](https://github.com/hospodskej-cz/eet-2-0/commit/6d3c4d191f1059e6b8455a99801c0e1667a09aa9))
* **contributing:** describe npm, Docker and binary publishing ([d1b23c7](https://github.com/hospodskej-cz/eet-2-0/commit/d1b23c7417e4a7535f34deacc0174c50314afe8d))
* name copyright holder and point changelog links to hospodskej-cz ([1b7d3b9](https://github.com/hospodskej-cz/eet-2-0/commit/1b7d3b940dae1aaaffd1a194a2cce37fc05d00e0))
* **readme:** badges, quick start, status and limitations, disclaimer ([aa9beb9](https://github.com/hospodskej-cz/eet-2-0/commit/aa9beb91aded905ab0487abe032ea6cfaab5c822))
* **readme:** unofficial, no warranty, certification is the operator's own ([067b59e](https://github.com/hospodskej-cz/eet-2-0/commit/067b59eb5cdcc408c611705829a0e41ea5c7e6d5))
* **security:** private reporting enabled, audit status, best-effort response times ([d597f44](https://github.com/hospodskej-cz/eet-2-0/commit/d597f44c1d9b7db8925ddcd82fce9a63797535bb))
* **spec-notes:** production verification checklist and pilot report template ([8955565](https://github.com/hospodskej-cz/eet-2-0/commit/8955565964d57b5f92e21e940e339da47a77d9db))
* sync cross references; ci: verify npm tarballs; build: ship third-party notices ([c95f8d7](https://github.com/hospodskej-cz/eet-2-0/commit/c95f8d7d02bb3283e54f964fc8124d3a9ed9f497))
* threat model and external audit scoping with internal review results ([17c4c1a](https://github.com/hospodskej-cz/eet-2-0/commit/17c4c1a19b5d5b80451f6460498f36c03a69ca56))
* use the maintainer's public handle in CODEOWNERS and GOVERNANCE ([00e37ef](https://github.com/hospodskej-cz/eet-2-0/commit/00e37ef1ec5eccc5f2df79d614913356288d0274))

## 0.1.0 (2026-10-26)


### Features

* **cli:** eet command and standalone binaries ([096d178](https://github.com/hospodskej-cz/eet-2-0/commit/096d178eaae477a19818ab1d1456a9bc918a7c4b))
* **core:** send one sale to EET through EetTransport ([375b9c1](https://github.com/hospodskej-cz/eet-2-0/commit/375b9c1c9c0ffe7f64f1e48b5684f3d70d864765))
* **ingest:** all input formats and normalization into EET data ([e98b852](https://github.com/hospodskej-cz/eet-2-0/commit/e98b852acb18532ed8336a6e79b1bca099f9685d))
* **queue:** persistent queue with safe resending and idempotence ([9438a76](https://github.com/hospodskej-cz/eet-2-0/commit/9438a76bed7ed20954d5ef5a8c9a973d0d87b9e6))
* **server:** HTTP API v1 with OpenAPI 3.1, multi-register config and Docker ([e9b8f23](https://github.com/hospodskej-cz/eet-2-0/commit/e9b8f2326fe57f3d63088220f22015e71f9678f9))


### Documentation

* **contributing:** how to check and merge the release PR ([41c3b66](https://github.com/hospodskej-cz/eet-2-0/commit/41c3b66f09a20884a004f9407a4c9ea830c0d0ab))
* README in Czech and English, integration examples, CONTRIBUTING, SECURITY ([c35d2f0](https://github.com/hospodskej-cz/eet-2-0/commit/c35d2f0be397065304bb6017b8db13b61923f088))
* **spec-notes:** live playground round trip, response signer captured ([6a172cc](https://github.com/hospodskej-cz/eet-2-0/commit/6a172ccbb56c313c073f25c69cf3991140c152e7))
* **spec-notes:** record verified playground CA certificates ([14d7c53](https://github.com/hospodskej-cz/eet-2-0/commit/14d7c53af122894cf27851e6cb25adf3825d3334))

## Changelog

Všechny podstatné změny projektu. Spravuje ho [release-please](https://github.com/googleapis/release-please) z Conventional Commits; verze se řídí [semver 0.x](CONTRIBUTING.md#commity-a-vydání).
