import { getDistance } from '../helpers/getDistance.js'
import { rainbowColors } from '../helpers/rainbowColors.js';

const communistColor = {
    r: 255,
    g: 20,
    b: 20
}

const jasmine = (sticks, sensors) => {
    return sensors.map(sensor => {
        const tension = sensor.tension

        if (tension) {
            return sticks.map(stick => {
                const leds = []
                if (sensor && tension >= 0) {
                    const numberOfLEDs = stick.numberOfLEDs
                    const distance = getDistance({
                        sensor,
                        stick,
                        allSticks: sticks
                    })

                    if (distance === 0) {
                        if (!sensor.isSlowSensor && sensor.stick === stick.name && tension >= 10) {
                            [...Array(numberOfLEDs)].map((el, key) => leds.push({
                                number: key,
                                color: communistColor
                            }))
                        }
                    } else {
                        [...Array(numberOfLEDs)].map((el, key) => {
                            const randomWarmColor = {
                                r: Math.floor(Math.random() * 255),
                                g: Math.floor(Math.random() * 150),
                                b: Math.floor(Math.random() * 100)
                            }

                            if (randomWarmColor.r + randomWarmColor.g + randomWarmColor.b > 450)
                                leds.push({
                                    number: key,
                                    color: randomWarmColor
                                })
                        })
                    }
                }

                return {
                    key: stick.name,
                    leds: leds.filter(Boolean)
                }
            })
        }
    })
}

export default jasmine