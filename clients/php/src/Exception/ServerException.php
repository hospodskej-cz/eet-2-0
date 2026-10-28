<?php

declare(strict_types=1);

namespace EetGateway\Client\Exception;

/** 5xx: the gateway failed (details only in its log). */
final class ServerException extends ApiException
{
}
