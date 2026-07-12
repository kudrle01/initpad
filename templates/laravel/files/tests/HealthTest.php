<?php

namespace Tests;

final class HealthTest extends TestCase
{
    public function testHealthEndpoint(): void
    {
        $this->get('/up')->assertOk();
        $this->get('/')->assertOk()->assertJson(['status' => 'ok']);
    }
}
