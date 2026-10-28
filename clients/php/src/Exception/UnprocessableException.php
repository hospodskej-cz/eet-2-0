<?php

declare(strict_types=1);

namespace EetGateway\Client\Exception;

/** 422 with an error body, e.g. `single_sale_expected` (a batch sent to submitSale). */
final class UnprocessableException extends ApiException
{
}
