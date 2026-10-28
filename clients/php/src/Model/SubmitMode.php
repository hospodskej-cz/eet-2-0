<?php

declare(strict_types=1);

namespace EetGateway\Client\Model;

/** How a submit waits for EET. */
enum SubmitMode: string
{
    /** Wait for the first attempt (default for a single sale). */
    case Sync = 'sync';
    /** Store, answer 202 at once, send in the background (default for a batch). */
    case Async = 'async';
}
