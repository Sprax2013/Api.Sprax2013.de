import request = require('request');
import sharp = require('sharp');
import { createHash, HashOptions } from 'crypto';
import { Request, Response } from 'express';
import { EOL } from 'os';
import { toASCII as punycodeToASCII } from 'punycode';

import { appVersion, cfg, errorLogStream } from '..';
import { Color } from '../global';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    UUID_PATTERN_ADD_DASH = /(.{8})(.{4})(.{4})(.{4})(.{12})/,
    FQDN_PATTERN = /^(?=.{1,253})(?!.*--.*)(?:(?![0-9-])[a-z0-9-]{1,63}(?<!-)\.)+(?:(?![0-9-])[a-z0-9-]{1,63}(?<!-))\.?$/i;

export class Image {
  img: { data: Buffer, info: sharp.OutputInfo };

  static firstSkinLayerAreas = [
    {x: 8, y: 0, w: 16, h: 8},
    {x: 0, y: 8, w: 32, h: 8},

    {x: 0, y: 20, w: 56, h: 12},
    {x: 4, y: 16, w: 8, h: 4},
    {x: 20, y: 16, w: 16, h: 4},
    {x: 44, y: 16, w: 8, h: 4},

    {x: 16, y: 52, w: 16, h: 12},
    {x: 32, y: 52, w: 16, h: 12},
    {x: 20, y: 48, w: 8, h: 4},
    {x: 36, y: 48, w: 8, h: 4}];

  static secondSkinLayerAreas = [
    {x: 40, y: 0, w: 16, h: 8},
    {x: 32, y: 8, w: 32, h: 8},

    {x: 0, y: 36, w: 56, h: 12},
    {x: 4, y: 32, w: 8, h: 4},
    {x: 20, y: 32, w: 16, h: 4},
    {x: 44, y: 32, w: 8, h: 4},

    {x: 0, y: 52, w: 16, h: 12},
    {x: 48, y: 52, w: 16, h: 12},
    {x: 4, y: 48, w: 8, h: 4},
    {x: 52, y: 48, w: 8, h: 4}];

  /**
   * Use `Image.fromImg`
   */
  constructor(rgbaArr: { data: Buffer, info: sharp.OutputInfo }) {
    this.img = rgbaArr;
  }

  static empty(width: number, height: number, callback: (err: Error | null, img: Image | null) => void,
               background: { r: number, g: number, b: number, alpha: number } = {r: 0, g: 0, b: 0, alpha: 0}): void {
    sharp({
      create: {
        background,
        channels: 4,
        width,
        height
      }
    }).raw()
        .toBuffer({resolveWithObject: true})
        .then((res) => callback(null, new Image(res)))
        .catch((err) => callback(err, null));
  }

  static fromRaw(rgba: Buffer, width: number, height: number, channels: 1 | 2 | 3 | 4, callback: (err?: Error, img?: Image) => void): void {
    const result = sharp(rgba, {raw: {width, height, channels}})
        .ensureAlpha();

    result.toBuffer({resolveWithObject: true})
        .then((res) => callback(undefined, new Image(res)))
        .catch((err) => callback(err));
  }

  static fromImg(img: string | Buffer, callback: (err: Error | null, rawImg: Image | null) => void, width?: number, height?: number): void {
    const result = sharp(img)
        .ensureAlpha()
        .raw();

    if (width && height) {
      result.resize(width, height, {kernel: 'nearest', fit: 'outside'});
    }

    result.toBuffer({resolveWithObject: true})
        .then((res) => callback(null, new Image(res)))
        .catch((err) => callback(err, null));
  }

  /**
   * Full alpha or no alpha in skin overlay
   */
  resetSkinOverlayAlpha() {
    const black = {r: 0, g: 0, b: 0, alpha: 0};

    for (const area of Image.secondSkinLayerAreas) {
      for (let i = 0; i < area.w; i++) {
        for (let j = 0; j < area.h; j++) {
          const x = area.x + i,
              y = area.y + j;
          const color: Color = this.getColor(x, y);

          this.setColor(x, y, color.alpha > 0 ? {r: color.r, g: color.g, b: color.b, alpha: 255} : black);
        }
      }
    }
  }

  /**
   * Combine (additive) two RGBA colors
   *
   * **Having alpha 0 will return the other color or a color with all 0**
   */
  static mergeColors(col1: Color, col2: Color): Color {
    const col1Alpha = col1.alpha / 255,
        col2Alpha = col2.alpha / 255;

    if (col1Alpha <= 0 && col2Alpha <= 0) {
      return {r: 0, g: 0, b: 0, alpha: 0};
    } else if (col1Alpha <= 0) {
      return {r: col2.r, g: col2.g, b: col2.b, alpha: col2.alpha};
    } else if (col2Alpha <= 0) {
      return {r: col1.r, g: col1.g, b: col1.b, alpha: col1.alpha};
    }

    const alpha = 1 - (1 - col2Alpha) * (1 - col1Alpha),
        r = Math.round((col2.r * col2Alpha / alpha) + (col1.r * col1Alpha * (1 - col2Alpha) / alpha)),
        g = Math.round((col2.g * col2Alpha / alpha) + (col1.g * col1Alpha * (1 - col2Alpha) / alpha)),
        b = Math.round((col2.b * col2Alpha / alpha) + (col1.b * col1Alpha * (1 - col2Alpha) / alpha));

    return {r, g, b, alpha: alpha * 255};
  }

  async toPngBuffer(width?: number, height?: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const result = sharp(this.img.data, {
        raw: {
          channels: 4,
          width: this.img.info.width,
          height: this.img.info.height
        }
      }).png();

      if (width || height) {
        result.resize(width || this.img.info.width, height || this.img.info.height, {
          kernel: 'nearest',
          fit: 'outside'
        });
      }

      result.toBuffer((err, buffer, _info) => {
        if (err) return reject(err);

        resolve(buffer);
      });
    });
  }

  resize(width: number, height: number, callback: (err: Error | null, png: Image | null) => void): void {
    if (this.img.info.width == width && this.img.info.height == height) return callback(null, this);

    sharp(this.img.data, {
      raw: {
        channels: 4,
        width: this.img.info.width,
        height: this.img.info.height
      }
    })
        .resize(width, height, {kernel: 'nearest', fit: 'outside'})

        .raw()
        .toBuffer({resolveWithObject: true})

        .then((res) => callback(null, new Image(res)))
        .catch((err) => callback(err, null));
  }

  getColor(x: number, y: number): Color {
    if (x < 0 || y < 0) throw new Error('coordinates cannot be negative');
    if (x >= this.img.info.width || y >= this.img.info.height) throw new Error(`coordinates(x=${x}, y=${y}) are out of bounds(width=${this.img.info.width}, height=${this.img.info.height})`);

    return {
      r: this.img.data[(x * 4) + (y * (this.img.info.width * 4))],
      g: this.img.data[(x * 4) + (y * (this.img.info.width * 4)) + 1],
      b: this.img.data[(x * 4) + (y * (this.img.info.width * 4)) + 2],
      alpha: this.img.data[(x * 4) + (y * (this.img.info.width * 4)) + 3]
    };
  }

  setColor(x: number, y: number, color: Color): void {
    if (x < 0 || y < 0) throw new Error('coordinates cannot be negative');
    if (x >= this.img.info.width || y >= this.img.info.height) throw new Error(`coordinates(x=${x}, y=${y}) are out of bounds(width=${this.img.info.width}, height=${this.img.info.height})`);

    this.img.data[(x * 4) + (y * (this.img.info.width * 4))] = color.r;
    this.img.data[(x * 4) + (y * (this.img.info.width * 4)) + 1] = color.g;
    this.img.data[(x * 4) + (y * (this.img.info.width * 4)) + 2] = color.b;
    this.img.data[(x * 4) + (y * (this.img.info.width * 4)) + 3] = color.alpha;
  }

  drawImg(imgToDraw: Image, x: number, y: number): void {
    for (let i = 0; i < imgToDraw.img.info.width; i++) {
      for (let j = 0; j < imgToDraw.img.info.height; j++) {
        const targetX = x + i,
            targetY = y + j;

        if (targetX <= this.img.info.width && targetY <= this.img.info.height) {
          this.setColor(targetX, targetY, imgToDraw.getColor(i, j));
        }
      }
    }
  }

  drawSubImg(imgToDraw: Image, subX: number, subY: number, width: number, height: number, targetX: number, targetY: number, ignoreAlpha: boolean = false, mode: 'replace' | 'add' = 'replace'): void {
    for (let i = 0; i < width; i++) {
      for (let j = 0; j < height; j++) {
        const newTargetX = targetX + i,
            newTargetY = targetY + j;

        const color: Color = imgToDraw.getColor(subX + i, subY + j);
        if (newTargetX <= this.img.info.width && newTargetY <= this.img.info.height && color.alpha > 0) {
          let newColor = {r: color.r, g: color.g, b: color.b, alpha: ignoreAlpha ? 255 : color.alpha};

          if (mode == 'add') {
            newColor = Image.mergeColors(this.getColor(newTargetX, newTargetY), newColor);
          }

          this.setColor(newTargetX, newTargetY, newColor);
        }
      }
    }
  }

  /**
   * @author NudelErde (https://github.com/NudelErde/)
   */
  drawSubImgFlipped(imgToDraw: Image, originX: number, originY: number, width: number, height: number, targetX: number, targetY: number): void {
    for (let i = 0; i < width; i++) {
      for (let j = 0; j < height; j++) {
        const newX = targetX + width - i - 1,
            newY = targetY + j;

        const color = imgToDraw.getColor(originX + i, originY + j);
        if (newX <= this.img.info.width && newY <= this.img.info.height && color.alpha > 0) {
          this.setColor(newX, newY, color);
        }
      }
    }
  }

  drawRect(x: number, y: number, width: number, height: number, color: Color): void {
    for (let i = 0; i < width; i++) {
      for (let j = 0; j < height; j++) {
        this.setColor(x + i, y + j, color);
      }
    }
  }

  /**
   * Very time consuming!
   */
  trimTransparency(callback: (err?: Error, newImage?: Image) => void) {
    let startingX = 0, endingX = this.img.info.width,
        startingY = 0, endingY = this.img.info.height;

    // Top
    for (let y = 0; y < this.img.info.height; y++) {
      let rowIsTransparent = true;

      for (let x = 0; x < this.img.info.width; x++) {
        if (this.getColor(x, y).alpha != 0) {
          rowIsTransparent = false;
          break;
        }
      }

      if (!rowIsTransparent) {
        startingY = y;
        break;
      }
    }

    // Right
    for (let x = this.img.info.width - 1; x >= 0; x--) {
      let colIsTransparent = true;

      for (let y = startingY; y < this.img.info.height; y++) {
        if (this.getColor(x, y).alpha != 0) {
          colIsTransparent = false;
          break;
        }
      }

      if (!colIsTransparent) {
        endingX = x;
        break;
      }
    }

    // Bottom
    for (let y = this.img.info.height - 1; y >= 0; y--) {
      let rowIsTransparent = true;

      for (let x = startingX; x < this.img.info.width; x++) {
        if (this.getColor(x, y).alpha != 0) {
          rowIsTransparent = false;
          break;
        }
      }

      if (!rowIsTransparent) {
        endingY = y;
        break;
      }
    }

    // Left
    for (let x = startingX; x < this.img.info.width; x++) {
      let colIsTransparent = true;

      for (let y = startingY; y < this.img.info.height; y++) {
        if (this.getColor(x, y).alpha != 0) {
          colIsTransparent = false;
          break;
        }
      }

      if (!colIsTransparent) {
        startingX = x;
        break;
      }
    }

    Image.empty(endingX - startingX, endingY - startingY, (err, img) => {
      if (err || !img) return callback(err || new Error());

      img.drawSubImg(this, startingX, startingY, endingX - startingX, endingY - startingY, 0, 0);
      return callback(undefined, img);
    });
  }

  /* Skin */

  /**
   * Upgrades the skin to 64x64px and remove unused parts
   *
   * Creates an png Buffer to use
   */
  async toCleanSkinBuffer(): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      this.toCleanSkin((err) => {
        if (err) return reject(err);

        this.toPngBuffer()
            .then(resolve)
            .catch(reject);
      });
    });
  }

  /**
   * Upgrades the skin to 64x64px and remove unused parts
   */
  toCleanSkin(callback: (err: Error | null) => void): void {
    this.upgradeSkin((err) => {
      if (err) return callback(err);

      this.removeUnusedSkinParts();
      this.ensureSkinAlpha();

      callback(null);
    });
  }

  hasSkinDimensions(): boolean {
    return this.img.info.width == 64 && (this.img.info.height == 64 || this.img.info.height == 32);
  }

  isSlimSkinModel(): boolean {
    return this.getColor(55, 20).alpha == 0;
  }

  upgradeSkin(callback: (err: Error | null) => void): void {
    if (!this.hasSkinDimensions()) throw new Error('Image does not have valid skin dimensions');
    if (this.img.info.height != 32) return callback(null);

    sharp({
      create: {
        channels: 4,
        height: 64,
        width: 64,
        background: {
          r: 0,
          g: 0,
          b: 0,
          alpha: 0
        }
      }
    })
        .raw()
        .toBuffer({resolveWithObject: true})

        .then((res) => {
          const newImg: Image = new Image(res);

          newImg.drawImg(this, 0, 0);

          newImg.drawSubImgFlipped(this, 8, 16, 4, 4, 24, 48);
          newImg.drawSubImgFlipped(this, 4, 16, 4, 4, 20, 48);
          newImg.drawSubImgFlipped(this, 44, 16, 4, 4, 36, 48);
          newImg.drawSubImgFlipped(this, 48, 16, 4, 4, 40, 48);
          newImg.drawSubImgFlipped(this, 4, 20, 4, 12, 20, 52);
          newImg.drawSubImgFlipped(this, 8, 20, 4, 12, 16, 52);
          newImg.drawSubImgFlipped(this, 12, 20, 4, 12, 28, 52);
          newImg.drawSubImgFlipped(this, 0, 20, 4, 12, 24, 52);

          newImg.drawSubImgFlipped(this, 44, 20, 4, 12, 36, 52);
          newImg.drawSubImgFlipped(this, 48, 20, 4, 12, 32, 52);
          newImg.drawSubImgFlipped(this, 52, 20, 4, 12, 44, 52);
          newImg.drawSubImgFlipped(this, 40, 20, 4, 12, 40, 52);

          this.img = newImg.img;
          callback(null);
        })
        .catch((err) => callback(err));
  }

  removeUnusedSkinParts() {
    if (!this.hasSkinDimensions()) throw new Error('Image does not have valid skin dimensions');
    if (this.img.info.height != 64) throw new Error('Legacy skin dimensions are not supported');

    const noColor: Color = {r: 0, g: 0, b: 0, alpha: 0};

    this.drawRect(0, 0, 8, 8, noColor);
    this.drawRect(24, 0, 16, 8, noColor);
    this.drawRect(56, 0, 8, 8, noColor);
    this.drawRect(0, 16, 4, 4, noColor);
    this.drawRect(12, 16, 8, 4, noColor);
    this.drawRect(36, 16, 8, 4, noColor);
    this.drawRect(56, 16, 8, 16, noColor);
    this.drawRect(52, 16, 4, 4, noColor);

    this.drawRect(0, 32, 4, 4, noColor);
    this.drawRect(0, 48, 4, 4, noColor);
    this.drawRect(12, 32, 8, 4, noColor);
    this.drawRect(12, 48, 8, 4, noColor);
    this.drawRect(28, 48, 8, 4, noColor);
    this.drawRect(36, 32, 8, 4, noColor);
    this.drawRect(44, 48, 8, 4, noColor);
    this.drawRect(52, 32, 4, 4, noColor);
    this.drawRect(60, 48, 4, 4, noColor);
    this.drawRect(56, 32, 8, 16, noColor);

    for (let x = 0; x < this.img.info.width; x++) {
      for (let y = 0; y < this.img.info.height; y++) {
        const col = this.getColor(x, y);

        if (col.alpha == 0 && (col.r != 0 || col.g != 0 || col.b != 0)) {
          this.setColor(x, y, noColor);
        }
      }
    }
  }

  /**
   * Full alpha color or full alpha black on first skin layer
   */
  ensureSkinAlpha() {
    if (!this.hasSkinDimensions()) throw new Error('Image does not have valid skin dimensions');
    if (this.img.info.height != 64) throw new Error('Legacy skin dimensions are not supported');

    const black = {r: 0, g: 0, b: 0, alpha: 255};

    for (const area of Image.firstSkinLayerAreas) {
      for (let i = 0; i < area.w; i++) {
        for (let j = 0; j < area.h; j++) {
          const x = area.x + i,
              y = area.y + j;
          const color: Color = this.getColor(x, y);

          this.setColor(x, y, color.alpha > 0 ? {r: color.r, g: color.g, b: color.b, alpha: 255} : black);
        }
      }
    }
  }

  async generateSkinAlternatives(): Promise<Image[]> {
    return new Promise((resolve, reject) => {
      const getClone = (): Image => {
        const buffer = Buffer.alloc(this.img.data.byteLength);
        this.img.data.copy(buffer);

        return new Image({data: buffer, info: Object.assign({}, this.img.info)});
      };

      let waitingFor = 0;
      const result: Image[] = [];

      const done = (): void => {
        waitingFor--;

        if (waitingFor == 0) {
          resolve(result);
        }
      };

      const noColor = {r: 0, g: 0, b: 0, alpha: 0};

      waitingFor += 3;
      const noOverlay = getClone(),
          overlayIsFirstLayer = getClone(),
          overlayOnTopOfFirstLayer = getClone();

      noOverlay.toCleanSkin((err) => {
        if (err) reject(err);

        // Remove the second skin layer
        for (const area of Image.secondSkinLayerAreas) {
          for (let i = 0; i < area.w; i++) {
            for (let j = 0; j < area.h; j++) {
              noOverlay.setColor(area.x + i, area.y + j, noColor);
            }
          }
        }

        result.push(noOverlay);
        done();
      });

      const moveSecondLayer = (img: Image, mergeColors: boolean) => {
        for (let i = 0; i < Image.firstSkinLayerAreas.length; i++) {
          const firstLayerArea = Image.firstSkinLayerAreas[i],
              secondLayerArea = Image.secondSkinLayerAreas[i];

          for (let j = 0; j < firstLayerArea.w; j++) {
            for (let k = 0; k < firstLayerArea.h; k++) {
              const fX = firstLayerArea.x + j,
                  fY = firstLayerArea.y + k,
                  sX = secondLayerArea.x + j,
                  sY = secondLayerArea.y + k;

              const color = mergeColors ?
                  Image.mergeColors(img.getColor(fX, fY), img.getColor(sX, sY)) :
                  img.getColor(sX, sY);

              // Move pixel from overlay to first layer
              img.setColor(fX, fY, {r: color.r, g: color.g, b: color.b, alpha: 255});

              // Remove overlay pixel
              img.setColor(sX, sY, noColor);
            }
          }
        }
      };

      overlayIsFirstLayer.toCleanSkin((err) => {
        if (err) reject(err);

        moveSecondLayer(overlayIsFirstLayer, false);

        result.push(overlayIsFirstLayer);
        done();
      });

      overlayOnTopOfFirstLayer.toCleanSkin((err) => {
        if (err) reject(err);

        moveSecondLayer(overlayOnTopOfFirstLayer, true);

        result.push(overlayOnTopOfFirstLayer);
        done();
      });
    });
  }
}

export class ApiError extends Error {
  readonly httpCode: number;
  readonly details?: { param: string, condition: string }[];
  logged: boolean;

  static discordHookCounter: number = 0;

  constructor(message: string, httpCode: number, details?: { param: string, condition: string }[], logged?: boolean) {
    super(message);

    this.httpCode = httpCode;
    this.details = details;
    this.logged = logged || false;
  }

  static fromError(err: Error): ApiError {
    return new ErrorBuilder().log(err.message, err.stack).unknown();
  }

  static async log(msg: string, obj?: any, skipWebHook: boolean = false) {
    const stack = new Error().stack;

    console.error('An error occurred:', msg, typeof obj != 'undefined' ? obj : '', process.env.NODE_ENV != 'production' ? stack : '');

    if (errorLogStream) {
      errorLogStream.write(`[${new Date().toUTCString()}] ${JSON.stringify({msg, obj, stack})}` + EOL);
    }

    // Contact Discord-WebHook
    if (!skipWebHook && cfg && cfg.logging.discordErrorWebHookURL &&
        cfg.logging.discordErrorWebHookURL.toLowerCase().startsWith('http') && ApiError.discordHookCounter++ < 3) {
      request.post(cfg.logging.discordErrorWebHookURL, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': `SpraxAPI/${appVersion}`,
          Accept: 'application/json'
        },
        body: JSON.stringify({
          username: 'SpraxAPI (Error-Reporter)',
          avatar_url: 'https://cdn.discordapp.com/attachments/611940958568841227/684083067073200138/SpraxAPI-4096px.png',
          embeds: [
            {
              title: 'An error occurred',
              fields: [
                {
                  name: 'Message',
                  value: msg
                },
                {
                  name: 'Object',
                  value: obj != undefined ? '```JS\n' + JSON.stringify(obj, null, 2) + '\n```' : 'Empty'
                }
              ]
            }
          ]
        })
      }, (err: Error, res, body) => {
        if (err) return ApiError.log('Could not execute Discord-WebHook', {msg: err.message}, true);
        if (res.statusCode != 204) return ApiError.log(`Could not execute Discord-WebHook: ${body}`, undefined, true);
      });
    }
  }
}

setInterval(() => ApiError.discordHookCounter = 0, 60 * 1000);

export class ErrorBuilder {
  logged: boolean = false;

  constructor() {
  }

  log(msg: string, obj?: any): this {
    ApiError.log(msg, obj);
    this.logged = true;

    return this;
  }

  unknown(): ApiError {
    return new ApiError('An unknown error occurred', 500, undefined, this.logged);
  }

  notFound(whatCouldNotBeFound: string = 'The requested resource could not be found', adminLog?: string | boolean): ApiError {
    if (adminLog) {
      this.log(typeof adminLog == 'boolean' ? `This should not have happened: ${whatCouldNotBeFound}` : adminLog);
    }

    return new ApiError(`${whatCouldNotBeFound}${adminLog ? ' (server-side error)' : ''}`, adminLog ? 500 : 404, undefined, this.logged);
  }

  serverErr(whatFailed: string = 'An error occurred', adminLog?: string | boolean): ApiError {
    if (adminLog) {
      this.log(typeof adminLog == 'boolean' ? `This should not have happened: ${whatFailed}` : adminLog);
    }

    return new ApiError(`${whatFailed}`, 500, undefined, this.logged);
  }

  serviceUnavailable(description: string = 'Service Unavailable', adminLog?: string | boolean): ApiError {
    if (adminLog) {
      this.log(typeof adminLog == 'boolean' ? `This should not have happened: ${description}` : adminLog);
    }

    return new ApiError(`${description}`, 503, undefined, this.logged);
  }

  invalidParams(paramType: 'url' | 'query', params: { param: string, condition: string }[]): ApiError {
    return new ApiError(`Missing or invalid ${paramType} parameters`, 400, params, this.logged);
  }

  invalidBody(expected: { param: string, condition: string }[]): ApiError {
    return new ApiError(`Missing or invalid body`, 400, expected, this.logged);
  }
}

export class HttpError {
  static getName(httpCode: number): string | null {
    /* 100s */
    if (httpCode == 100) return 'Continue';
    if (httpCode == 101) return 'Switching Protocols';
    if (httpCode == 102) return 'Processing';

    /* 200s */
    if (httpCode == 200) return 'OK';
    if (httpCode == 201) return 'Created';
    if (httpCode == 202) return 'Accepted';
    if (httpCode == 203) return 'Non-Authoritative Information';
    if (httpCode == 204) return 'No Content';
    if (httpCode == 205) return 'Reset Content';
    if (httpCode == 206) return 'Partial Content';
    if (httpCode == 207) return 'Multi-Status';

    /* 300s */
    if (httpCode == 300) return 'Multiple Choices';
    if (httpCode == 301) return 'Moved Permanently';
    if (httpCode == 302) return 'Found (Moved Temporarily)';
    if (httpCode == 303) return 'See Other';
    if (httpCode == 304) return 'Not Modified';
    if (httpCode == 305) return 'Use Proxy';
    if (httpCode == 307) return 'Temporary Redirect';
    if (httpCode == 308) return 'Permanent Redirect';

    /* 400s */
    if (httpCode == 400) return 'Bad Request';
    if (httpCode == 401) return 'Unauthorized';
    if (httpCode == 402) return 'Payment Required';
    if (httpCode == 403) return 'Forbidden';
    if (httpCode == 404) return 'Not Found';
    if (httpCode == 405) return 'Method Not Allowed';
    if (httpCode == 406) return 'Not Acceptable';
    if (httpCode == 407) return 'Proxy Authentication Required';
    if (httpCode == 408) return 'Request Timeout';
    if (httpCode == 409) return 'Conflict';
    if (httpCode == 410) return 'Gone';
    if (httpCode == 411) return 'Length Required';
    if (httpCode == 412) return 'Precondition Failed';
    if (httpCode == 413) return 'Request Entity Too Large';
    if (httpCode == 414) return 'URI Too Long';
    if (httpCode == 415) return 'Unsupported Media Type';
    if (httpCode == 416) return 'Requested range not satisfiable';
    if (httpCode == 417) return 'Expectation Failed';
    if (httpCode == 420) return 'Policy Not Fulfilled';
    if (httpCode == 421) return 'Misdirected Request';
    if (httpCode == 422) return 'Unprocessable Entity';
    if (httpCode == 423) return 'Locked';
    if (httpCode == 424) return 'Failed Dependency';
    if (httpCode == 426) return 'Upgrade Required';
    if (httpCode == 428) return 'Precondition Required';
    if (httpCode == 429) return 'Too Many Requests';
    if (httpCode == 431) return 'Request Header Fields Too Large';
    if (httpCode == 451) return 'Unavailable For Legal Reasons';

    /* 500s */
    if (httpCode == 500) return 'Internal Server Error';
    if (httpCode == 501) return 'Not Implemented';
    if (httpCode == 502) return 'Bad Gateway';
    if (httpCode == 503) return 'Service Unavailable';
    if (httpCode == 504) return 'Gateway Timeout';
    if (httpCode == 505) return 'HTTP Version not supported';
    if (httpCode == 506) return 'Variant Also Negotiates';
    if (httpCode == 507) return 'Insufficient Storage';
    if (httpCode == 508) return 'Loop Detected';

    return null;
  }
}

/**
 * This shortcut function responses with HTTP 405 to the requests having
 * a method that does not have corresponding request handler.
 *
 * For example if a resource allows only GET and POST requests then
 * PUT, DELETE, etc. requests will be responded with the 405.
 *
 * HTTP 405 is required to have Allow-header set to a list of allowed
 * methods so in this case the response has "Allow: GET, POST, HEAD" in its headers.
 *
 * Example usage
 *
 *    // A handler that allows only GET (and HEAD) requests and returns
 *    app.all('/path', (req, res, next) => {
 *      restful(req, res, {
 *        get: () => {
 *          res.send('Hello world!');
 *        }
 *      });
 *    });
 *
 * Original author: https://stackoverflow.com/a/15754373/9346616
 */
export function restful(req: Request, res: Response, handlers: { [key: string]: () => void }): void {
  const method = (req.method || '').toLowerCase();

  if (method in handlers) return handlers[method]();
  if (method == 'head' && 'get' in handlers) return handlers['get']();

  const allowedMethods: string[] = Object.keys(handlers);
  if (!allowedMethods.includes('head')) {
    allowedMethods.push('head');
  }

  res.set('Allow', allowedMethods.join(', ').toUpperCase());
  res.sendStatus(405);
  // return next(ApiError.create(ApiErrs.METHOD_NOT_ALLOWED, { allowedMethods }));   // TODO: send error-custom body
}

export function setCaching(res: Response, cacheResource: boolean = true, publicResource: boolean = true, duration?: number, proxyDuration?: number | undefined): Response {
  let value = '';

  if (cacheResource) {
    value += publicResource ? 'public' : 'private';

    if (duration) {
      value += `, max-age=${duration}`;
    }

    if (proxyDuration) {
      value += `, s-maxage=${proxyDuration}`;
    } else if (typeof duration == 'number') {
      value += `, s-maxage=${duration}`;
    }
  } else {
    value = 'no-cache, no-store, must-revalidate';
  }

  return res.set('Cache-Control', value);
}

export function isUUID(str: string): boolean {
  str = str.toLowerCase();

  return str.length >= 32 && str.length <= 36 && (UUID_PATTERN.test(str) || UUID_PATTERN.test(str.replace(/-/g, '').replace(UUID_PATTERN_ADD_DASH, '$1-$2-$3-$4-$5')));
}

export function addHyphensToUUID(str: string): string {
  return str.replace(/-/g, '').replace(UUID_PATTERN_ADD_DASH, '$1-$2-$3-$4-$5');
}

export function convertFQDNtoASCII(str: string): string {
  return punycodeToASCII(str);
}

/**
 * Checks if a given string is a valid FQDN (Domain) based on RFC1034 and RFC2181
 *
 * @author https://regex101.com/library/SuU6Iq
 */
export function isValidFQDN(str: string): boolean {
  return FQDN_PATTERN.test(str);
}

/**
 * Only looks for http(s) protocol
 */
export function isHttpURL(str: string): boolean {
  return /^(http|https):\/\/[^]+$/.test(str.toLowerCase());
}

export function getFileNameFromURL(str: string, stripFileExtension: boolean = false): string {
  const url = new URL(str);

  let fileName = url.pathname.substring(url.pathname.lastIndexOf('/') + 1);

  if (stripFileExtension) {
    const i = fileName.lastIndexOf('.');

    if (i != -1) {
      return fileName.substring(0, i);
    }
  }

  return fileName;
}

/**
 * Checks if string only contains numbers (negative numbers are not allowed)
 */
export function isNumeric(str: string): boolean {
  return /^[0-9]+$/.test(str);
}

export function toBoolean(input: string | number | boolean): boolean {
  if (input) {
    if (typeof input == 'string') return input == '1' || input.toLowerCase() == 'true' || input.toLowerCase() == 't';
    if (typeof input == 'number') return input == 1;
  }

  return false;
}

export function toInt(input: string | number | boolean): number | null {
  if (input) {
    if (typeof input == 'number') return input;
    if (typeof input == 'string' && isNumeric(input)) return parseInt(input);
  }

  return null;
}

/**
 * Defaults to 'sha256' algorithm
 */
export function generateHash(data: Buffer | string, algorithm: string = 'sha256', options?: HashOptions): string {
  if (!(data instanceof Buffer)) {
    data = Buffer.from(data);
  }

  return createHash(algorithm, options).update(data).digest('hex');
}