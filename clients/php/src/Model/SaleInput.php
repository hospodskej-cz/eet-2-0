<?php

declare(strict_types=1);

namespace EetGateway\Client\Model;

/**
 * One sale as the gateway accepts it. Everything but `datTrzby` and `celkTrzba` is optional:
 * `eic_popl`, `id_jednotky` and `id_pokl` come from the register configuration unless set here.
 *
 * Instead of this class `submitSale()` also takes a plain array with any field the gateway's ingest
 * understands (docs/INGEST.md).
 */
final class SaleInput
{
    /**
     * @param \DateTimeInterface|string|int $datTrzby A DateTime is sent as ISO 8601 with offset;
     *                                                one without a zone is read in the register's time zone.
     * @param string|int|float $celkTrzba "123.50"; a float is formatted to 2 places.
     * @param array<string, mixed> $extra Any further field the ingest understands.
     */
    public function __construct(
        public readonly \DateTimeInterface|string|int $datTrzby,
        public readonly string|int|float $celkTrzba,
        public readonly string|int|null $poradCis = null,
        public readonly ?string $eicPopl = null,
        public readonly ?string $eicPoverujiciho = null,
        public readonly ?bool $povereniVicePopl = null,
        public readonly string|int|null $idJednotky = null,
        public readonly ?string $idPokl = null,
        public readonly string|int|float|null $urcenoCerpZuct = null,
        public readonly string|int|float|null $cerpZuct = null,
        public readonly ?bool $overeni = null,
        public readonly ?bool $prvniZaslani = null,
        public readonly ?string $register = null,
        public readonly array $extra = [],
    ) {
    }

    /** @return array<string, mixed> Wire format, null fields left out. */
    public function toArray(): array
    {
        $fields = [
            'eic_popl' => $this->eicPopl,
            'eic_poverujiciho' => $this->eicPoverujiciho,
            'povereni_vice_popl' => $this->povereniVicePopl,
            'id_jednotky' => $this->idJednotky,
            'id_pokl' => $this->idPokl,
            'porad_cis' => $this->poradCis,
            'dat_trzby' => $this->datTrzby,
            'celk_trzba' => $this->celkTrzba,
            'urceno_cerp_zuct' => $this->urcenoCerpZuct,
            'cerp_zuct' => $this->cerpZuct,
            'overeni' => $this->overeni,
            'prvni_zaslani' => $this->prvniZaslani,
            'register' => $this->register,
        ];
        return self::normalize(array_filter($fields, static fn (mixed $v): bool => $v !== null) + $this->extra);
    }

    /**
     * Makes a plain array JSON-ready: DateTime becomes ISO 8601 with offset, float amounts get two places.
     *
     * @param array<string, mixed> $sale
     * @return array<string, mixed>
     */
    public static function normalize(array $sale): array
    {
        foreach ($sale as $name => $value) {
            if ($value instanceof \DateTimeInterface) {
                $sale[$name] = $value->format('c');
            } elseif (is_float($value) && in_array($name, ['celk_trzba', 'urceno_cerp_zuct', 'cerp_zuct'], true)) {
                $sale[$name] = number_format($value, 2, '.', '');
            }
        }
        return $sale;
    }
}
