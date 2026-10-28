<?php

declare(strict_types=1);

namespace EetGateway\Client\Model;

/** The EET `<Data>` stored for a sale; every attempt sends exactly this. */
final class SaleData
{
    public function __construct(
        public readonly string $eicPopl,
        public readonly string $idJednotky,
        public readonly string $idPokl,
        public readonly string $poradCis,
        public readonly string $datTrzby,
        public readonly string $celkTrzba,
        public readonly ?string $eicPoverujiciho = null,
        public readonly ?bool $povereniVicePopl = null,
        public readonly ?string $urcenoCerpZuct = null,
        public readonly ?string $cerpZuct = null,
    ) {
    }

    /** @param array<string, mixed> $d */
    public static function fromArray(array $d): self
    {
        return new self(
            eicPopl: (string) $d['eic_popl'],
            idJednotky: (string) $d['id_jednotky'],
            idPokl: (string) $d['id_pokl'],
            poradCis: (string) $d['porad_cis'],
            datTrzby: (string) $d['dat_trzby'],
            celkTrzba: (string) $d['celk_trzba'],
            eicPoverujiciho: $d['eic_poverujiciho'] ?? null,
            povereniVicePopl: $d['povereni_vice_popl'] ?? null,
            urcenoCerpZuct: $d['urceno_cerp_zuct'] ?? null,
            cerpZuct: $d['cerp_zuct'] ?? null,
        );
    }
}
