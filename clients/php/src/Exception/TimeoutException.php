<?php

declare(strict_types=1);

namespace EetGateway\Client\Exception;

/** The gateway did not answer within the client timeout. */
final class TimeoutException extends TransportException
{
}
