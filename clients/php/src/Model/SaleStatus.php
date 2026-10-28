<?php

declare(strict_types=1);

namespace EetGateway\Client\Model;

/**
 * `SaleResult::$status`. A status newer than this library reads as {@see self::Unknown}.
 * Use `->value` for the wire string ("verification_ok").
 */
enum SaleStatus: string
{
    /** EET registered the sale; `pok` is set. */
    case Accepted = 'accepted';
    /** Verification mode: EET checked the message and registered nothing. */
    case VerificationOk = 'verification_ok';
    /** EET answered with an error (`code`, `message`). */
    case Rejected = 'rejected';
    /** Stored, not sent yet; the gateway keeps trying. */
    case Queued = 'queued';
    /** Sent, no answer; the gateway resends safely. */
    case Uncertain = 'uncertain';
    /** Failed the local check (`issues`); nothing was sent. */
    case Invalid = 'invalid';
    /** A status this library does not know yet. */
    case Unknown = 'unknown';

    public static function fromWire(mixed $value): self
    {
        return is_string($value) ? (self::tryFrom($value) ?? self::Unknown) : self::Unknown;
    }
}
