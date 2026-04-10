FROM php:8.2-fpm

# 系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl unzip libpng-dev libjpeg-dev libfreetype6-dev \
    libzip-dev libicu-dev libonig-dev libxml2-dev libcurl4-openssl-dev \
    supervisor \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j$(nproc) \
        pdo_mysql mbstring xml curl zip gd intl bcmath opcache \
    && pecl install redis && docker-php-ext-enable redis \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Composer
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# PHP 生产配置
RUN cp "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini"
COPY php/opcache.ini /usr/local/etc/php/conf.d/opcache.ini
COPY php/uploads.ini /usr/local/etc/php/conf.d/uploads.ini

WORKDIR /var/www/html

# 安装 Paymenter
ARG PAYMENTER_VERSION=v1.0
RUN git clone --branch ${PAYMENTER_VERSION} --depth 1 \
    https://github.com/paymenter/paymenter.git . \
    && composer install --no-dev --optimize-autoloader --no-interaction \
    && chown -R www-data:www-data /var/www/html \
    && chmod -R 755 storage bootstrap/cache

EXPOSE 9000

CMD ["php-fpm"]
