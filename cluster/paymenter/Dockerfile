FROM php:8.3-fpm

RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl unzip libpng-dev libjpeg-dev libfreetype6-dev \
    libzip-dev libicu-dev libonig-dev libxml2-dev libcurl4-openssl-dev \
    supervisor nodejs npm \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j$(nproc) \
        pdo_mysql mbstring xml curl zip gd intl bcmath opcache \
    && pecl install redis && docker-php-ext-enable redis \
    && apt-get clean

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

RUN cp "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini"
COPY php/opcache.ini /usr/local/etc/php/conf.d/opcache.ini
COPY php/uploads.ini /usr/local/etc/php/conf.d/uploads.ini

WORKDIR /var/www/html

ARG PAYMENTER_VERSION=v1.4.7
RUN git clone --branch ${PAYMENTER_VERSION} --depth 1 \
    https://github.com/paymenter/paymenter.git . \
    && composer install --no-dev --optimize-autoloader --no-interaction \
    && npm install && npm run build \
    && chown -R www-data:www-data /var/www/html \
    && chmod -R 755 storage bootstrap/cache

EXPOSE 9000

CMD ["php-fpm"]
