<?php

declare(strict_types=1);

namespace EetGateway\Client\Exception;

/** 413: the body is over the gateway limit (64 KiB a sale, 10 MiB a batch). */
final class PayloadTooLargeException extends ApiException
{
}
