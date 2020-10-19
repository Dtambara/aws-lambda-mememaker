'use strict'
const { exec } = require('child_process');
const { promisify } = require('util');
const shell = promisify(exec);
const decoratorValidator = require('./util/decoratorValidator');
const globalEnum = require('./util/globalEnum');
const Joi = require('@hapi/joi');
const axios = require('axios');
const { promises: { writeFile, readFile , unlink} } = require('fs');

class Handler {
    constructor() { };

    static validator() {
        return Joi.object({
            image: Joi.string().uri().required(),
            topText: Joi.string().max(200).min(2).required(),
            bottomText: Joi.string().max(200).optional()
        });
    }
    static async generateBase64(imagePath) {
        return readFile(imagePath, "base64");
    }
    static generateIdentifyCommand(imagePath) {
        const value = `
        gm identify \
        -verbose \
        ${imagePath} \
        `;

        const cmd = value.split('\n').join(' ');
        return cmd;
    }

    static async getImageSize(imagePath) {
        console.log('getting image size');
        const command = Handler.generateIdentifyCommand(imagePath);
        const { stdout } = await shell(command);
        const [line] = stdout.trim().split('\n').filter(text => ~text.indexOf('Geometry:'))
        console.log('aqui');
        console.log(line);
        const [width, height] = line.trim().replace('Geometry:', "").split('x');
        return {
            width: Number(width),
            height: Number(height)
        }
    }

    static setParameters(options, dimensions, imagePath) {
        return {
            topText: options.topText,
            bottomText: options.bottomText || "",
            font: __dirname + './resources/impact.ttf',
            fontSize: dimensions.width / 8,
            fontFill: '#FFF',
            textPos: 'center',
            strokeColor: '#000',
            strokeWeight: 1,
            padding: 1,
            imagePath
        }
    }

    static async saveImageLocally(imageUrl, imagePath) {
        console.log('Saving image...');
        const { data } = await axios.get(imageUrl, { responseType: 'arraybuffer' })
    const buffer = Buffer.from(data, 'base64')
    return writeFile(imagePath, buffer)
    }

    static generateImagePath() {
        const isLocal = process.env.IS_LOCAL
        return `${isLocal ? "" : "/tmp/"}${new Date().getTime()}-out.png`
      }

    static setTextPosition(dimensions, padding) {
        const top = Math.abs((dimensions.height / 2.1) - padding) * -1;
        const bottom = (dimensions.height / 2.1) - padding;
        return { top, bottom };
    }

    static async generateConvertCommand(options, finalPath) {
        const value = `
        gm convert 
        '${options.imagePath}'
        -font '${options.font}'
        -pointsize '${options.fontSize}'
        -fill '${options.fontFill}'
        -stroke '${options.strokeColor}'
        -strokewidth '${options.strokeWeight}'
        -draw 'gravity ${options.textPos} text 0, ${options.top} "${options.topText}"'
        -draw 'gravity ${options.textPos} text 0, ${options.bottom} "${options.bottomText}"'
        ${finalPath}
        `;

        const final = value.split('\n').join(' ');
        const { stdout } = await shell(final);
        return stdout;
    }

    async main(event) {

        try {
            const options = event.queryStringParameters;
            const imagePath = Handler.generateImagePath();
            await Handler.saveImageLocally(options.image, imagePath);
            const dimensions = await Handler.getImageSize(imagePath);
            const params = Handler.setParameters(options, dimensions, imagePath);

            const { top, bottom } = Handler.setTextPosition(dimensions, params.padding);
            const finalPath = Handler.generateImagePath();
            const command = await Handler.generateConvertCommand({
                ...params,
                top,
                bottom
            }, finalPath);

            const imageBuffer = await Handler.generateBase64(finalPath);
            console.log('finishing');

            await Promise.all([
               unlink(imagePath),
               unlink(finalPath) 
            ]);
            const response = {
                statusCode: 200,
                headers: {
                    'Content-Type': 'text/html'
                },
                body: `<img src="data:image/jpeg;base64,${imageBuffer}"></img>`
            }
            return response;

        } catch (error) {
            console.error("error***", error.stack);
            return {
                statusCode: 500,
                body: 'Internal server error'
            }
        }
    }
}

const handler = new Handler();

module.exports = {
    mememaker: decoratorValidator(
        handler.main.bind(handler),
        Handler.validator(),
        globalEnum.ARG_TYPE.QUERYSTRING)
};