import { useEffect, useRef } from "react";
import { NekoEngine } from "./nekoEngine";

// generate a paw print PNG
function makePawPrint(): string {
  const c = document.createElement("canvas");
  c.width = 12; c.height = 10;
  const ctx = c.getContext("2d")!;
  const isDark = document.documentElement.classList.contains("dark");
  ctx.fillStyle = isDark ? "rgba(240,133,63,0.08)" : "rgba(224,107,32,0.08)";
  ctx.beginPath();
  ctx.ellipse(6, 6, 3, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();
  // toe pads
  const toes = [[2, 2], [5, 1], [8, 2], [10, 3], [3, 5.5], [5, 4.5], [7, 4.5], [8.5, 5.5]];
  toes.forEach(([x, y]) => {
    ctx.beginPath();
    ctx.ellipse(x, y, 1, 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  return c.toDataURL();
}

const CAT_SPRITES = [
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABIklEQVR4nO1WSQ7EMAiDUf//ZeYwoguYLdVIPdSnqklsB0gI0QsMeQJntKAiQuPLG7ILRUQkIUTjqfinMMCI4KcBzUUcpYFsV0oQCTgEBi9TdFwNMB27bakYka455Vc9l4LISCYAB6xBK6zYAtI0b0akg5CvKkLMxpgv+p9hIx/COUsfTmv7s6CF01pKQZT7QU3siIoQ4pxjFWPmy/fUzCT87YvoZKbkn6SAu1XeFW9PMtjDcI6IMWd5BfwjorUidLdZMSZZb1g6BQTqYdghbxkISaMGldXEtAZaJwEczVu9oN2ikZEKlQERkfSBkTWmam1l4BJudNtlhsDa+6dg+CRrIe0FaDdTVBGLIiAqnIkreSZiOBxZtHKyZfh0L+a/eA6+YR662bT+YjsAAAAASUVORK5CYII=",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA40lEQVR4nO1XyxLDIAiUTv7/l+mhsfUBsogZM233ZkZ2F2SIUpoHN2uaIUGDWrHEXH8iEqlMfq9rboU7wpcRmPeBCpfiUrb527mHk1C1iIGu5Kv2wgauAnJW5rmr5EA/QAYERyNBl8b2CiA9QG1m1hoVhzacqEogVeTqQcSasEj6MRM2oCqCo9jUGUVVWRORqwLC1BS1hk04I57jmtGsYvskNA14s88oqxAyMDuE0NiRgW4AzcAaSPfvgZ83EOqDVfeBlDb+C0Qj74V+SYV5D6eBknjJw+T2Tfj9BqKAX0B/aHgCdIBeOO78F8UAAAAASUVORK5CYII=",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABDklEQVR4nO1Wyw4DIQiEpv//y/TQuEVXmBG3ySbtnFQQRuWhSh02zLViBG0anXwE1otUU1Oh8JE5907a2MxOzsf1yb7wIBmBzpiqduMRbc3MujECJDASuVqXJvAtQAL+6huiGBjnIDBFROQJNeT85tEVMw5LBNg3XUxNESGzYDSE5m2NIQ4L0YzAzPCMhNsb+qGfAJ3Iy9jT0wQ8iZnD5jSSXUIAGV5x6oGCUCup5TaLgDijK6GqUmnF6h36hM67nSWRD7Ji/wYiB60FRynIABGwanA5EqmB+3fDP4HbEph9WCtYKsUe7CcFYbcUqySF5tJSDAyXe8YygeRUJRJLBIgr3eqeGUxASd3U/2G8AFt7mTLOfRenAAAAAElFTkSuQmCC",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABF0lEQVR4nO2W3Q6DMAiFYdn7vzK70E5KDpTS6s1GYqJt5XzlR8tUM1H3XPSx9LKIHAzMKRfuomUABKHn1DzUehUBoKCIkIh8gZhZwwl6970DAAExM4EoCR2RaBO8JQIRhH5utycEE21KQQQBrKuFbQCO2NBmAERd2fYb2sjLlTiwQ1tooZDTilEXyMh5NezavAgMxdMCV6qgFhrcLR6m+dY2zJgF2Lb7CsDj4hagZOaH040/AmD/gJbjdoBOrfB17ABWP6+VGrqlDTP9DwGqXbASuQbQKWuHXpXbta0QZ3avAciecpuzKCpaXA9nxRsAOmIzcAzFveesMQBonqC6dy4wPqcAtFj6gIJgZvM/vTiC2eTzbz9oHxxQekFCimcpAAAAAElFTkSuQmCC",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABKUlEQVR4nOWX3Q7CMAiFD2bv/8p4sdGxFljpT7zwJMaoG+cDCpnAv4sWxOAZj1kABgBmBtEZivnJc33v+mQAmkxrs8q0XBNBpAAsQy9zB6jx+yQASGdWkYGIysu7H2cVH6RHAiCUVCAAEIiHMhW44sddi1qBuwKlElmAtBRwmRgNmQVgPXISsPNGs02ZM2BOgScPsp4Iq6HaRX5vzImoO3vPHHBaoMrFlrlcIwHr917z5sMd++5VNsvAPLUJl0BEG1BkHcL5lBFnreWeAb3j35bPqDnwrEBZFBbQDnN9YWrGV5kDiU2YbcNSgFXjOASw0xw4D6G5ZrMa6b8AvAXalz6qFoxmMXofMPBI5rRneEQKQE8WM5l6+uwK3KvjV8ai7Q+lq9T8oVilL9sKg2SESmbvAAAAAElFTkSuQmCC",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABGElEQVR4nO2W3Q6DMAiFwfj+r8xupBLKb+vijSfZkilwPmmlA/j0snAhhzbzlwEIAIDo9kcc6csglcTJeCqyAZIlUGTsgLQgjk5wpgu2TpwAtJ6+AUHyvgewZF7QVNcC2DY3ukBeXQ0wgsTOdlWIGcaq7kiUABNhZkBEZgwiAptm3WQAMgbM8nDpLOG0B7rmXheieFBvgV53vGOffRMYVEIc6ubfzD0dhvl1qdZW3nD6Gn8qAAj2mpchLCC5rKr1UrR8GMmiVheqsCkAm0hTQbdlDgB4dhP1vKh0yDMfX77X/eRWF4Li4yfYJ+MISjtgbcTIWAwmTgyXOeyAiqFo6nmHTab2n1Ijz5ukjwNICDSurdT79Ol9/QD98LQSLfZm6wAAAABJRU5ErkJggg==",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABBklEQVR4nO1V0Q6EMAiDi///y9yLLHUC66Ymd4lNTNQArQWcyIsfgMH1NM8JHxERMxMzS4OeIm8C2OBV8v3jUgGqqh55txMluQsQFOFCbhAxJEcBd4qwgvz0UqMgTAZRUWyZG2Gv12pFQ9hXRDeqdS2Zcc4wdhsJQCFQzB80i2HRO0ANTrAtVB4jYAozg4oCMY9uAVMYgRtVxV0WkIFtyaUWrAJXEX1aHiSS8PDKb6ZboKq0vcxPbJN9Gsk/2NKul3WlsD44G+YJBi4cBGSrwwrJXKpENAGYXAzN0AbPj4T2B1ET0CdHSglEdTI3QkvCA2YRp7YGR/zyl9IinK97fpr3xYs/wxfuy7Lj/kO2hgAAAABJRU5ErkJggg==",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABHElEQVR4nO2WwRLDIAhEof//z9tLSJUAATTTQ7uHzKSi+6JIIfrry+JCLDat4060DGQcgO3PPHmXQUKDY/Ezhj7BU4y8q/gSQGig40bDFfNoAgyICc4wfw6gCNI+gluA1IJFiFfLJdABLvSg+PruB5hZXO8T7DEAZT7tyDjmAbAqMGmNSalAAECDhTtQgmDmi7kBcdHdEaQgxDh7c8abkskBlq9bkQeXTUKmhbyIVL0FJkS3aHUATMkRabi7dyJCB+CyC5KAACq5AiLi5R2wYLJTz0dTZl+Qci5ew2AdFhIzBwzTa14sAIjc5kXgjLF+B5OBsEAERvcLu/4NvSLFYiaAql94tB+YQLz82AnQKtX7i/vcgun14fz+w3oDTA6XRee9YIQAAAAASUVORK5CYII=",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABDklEQVR4nO2WSxLDIAxDUaf3v7K7aEKJI/8I7abRMjHWsw0Mrf27kIiRYvwSgG4q8vEHDuFLYFgSGU3pIlDvKaCwA6cfBtwGVYaIFtBRmMkmILxgyRpfgXBHUDVXEMxD9LeHleSqOVlPN7cJ4CWPlDUvA4iICwGgZF4G8CCYuYiEoywDMBmVp2QBIDvvq1rSASZdgDodvV1fA8jqWV2g571X5px/SzIFcMpiGLIToYTWfjgCa1N7AKeTYLU/o9mbMH0coxtS7ZUenHoT6qr321BXFcCivTfeISizCQEgfKYNtCzBCHHQ1Cmwqnc6Yramct/2Loxmuu3qe5i/BLAbkFm7r55VAGPymbW3blG9AHEphjo0CJF9AAAAAElFTkSuQmCC",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA80lEQVR4nO2WwRLDIAhEoZP//2V6qHZMdHGRNL24M7kosi+IjiI5WfmW9cqYm5mYWQV5HOAWbYC/AxzBeK/Z2jllE9KBUrqeSqpK52a3gDYvwSLk0WQAQuZRiBnAknkEInwKyv7S8zOIEICqiplBiNl8FACWf2RSzVG8gCrQFfAMGECk5ZuwNYnALQF4BuhP2SpEr+LOJCtUgXxmMi8C+FzmgePkqcnTJYQVqM+tEYR3D4zGvKeb24Q/qEAnCFAXZRutrkcQXg98V1y3ooXyxi/wp5zt4EynLExFBn8LfUIvom4AVCKSP9Nlo1Lc07VbW0/qDae6gB08t42YAAAAAElFTkSuQmCC",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA+0lEQVR4nO1Wyw7EIAiEzf7/L7MXadTKY6gemuwkPRSFGVFBojykfZHNs9/wyZKLXPGktzV7TyZtcLY/EqCMW+fBAk4gI6BPf5RaZG5aQBaCpF7xLTK5/whecQb+ApiZS8Gbn+sMZyASg4qF6gAzk4iYJPP4sTqwEqHkKNICEAIvS2UBHkl19UTBCVUuJbw5d6sMxk2eUin2SFFYW5B+0QBYxrQyoCnbJULI2IboEC6dvDqAxMkIOI5UL3jI4fpng7tXsXoFiYAtsKobImoFqA7MInqSqChtEdAHZ+ZbRiqFCTlgQ1s2fDNzBrziGg7Y/SJCkekRJ/rIOfwAzH6TFVfg/LAAAAAASUVORK5CYII=",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABA0lEQVR4nO2XzRKDMAiEwfH9X5kebDQSfhOcHurepDPuR8DVAvy78KH7UtSjEuA0Jbr8EW8Wg98KAA0FGkp3swPGJoqaa2as4+Fnt7BiroCU7kDIPAPCiyTUxeWqgth44WtCQs2bryoLfADwIDxlIUUAC8IyQMT0mFSAZshvqEHMmLsAFtjsPpQAZCUloARA2rZXdesB/EQbHJse3h5EPE+kP5nZvdjhmo2aeP31bBpqEkfw5MxDAJkuvTFYTwAHwH62XuIl4NKvY7d9fkItBXkaRgB2B2p4/1d2D+DnAHJDac4r0RwJohuEtScsSUNEGWzza6kBRL8FZwA8hf+MvHrV6wMLunpMS0n3sAAAAABJRU5ErkJggg==",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABHUlEQVR4nO2WyxbDIAhEh578/y/TRWpKEFCRnm4yS19zeWgCPPqzaHM/756dBbiMmW0GIpLnW4sIAI6MeTP9mGjTm4Fcr9YyAEpnQEIoILLWeYBbJQggIOcdOAAFJWBmMLNrPNJqBsx6Thk5GXhFZrh3b855oAagzc7BM9prLhv9DEBnJsd/YdwBCIgGAj2n7/2svPp3ABLCirpBrIBE5npiqcPl3c+aA7l3YCiRoWGqygFmopaK3oFQzgdmybwB3E4afOGuJszeCK0DJ/FU90WNl4ke+JZgaqM2r8hCyTXMRg+oJmwRRZG1+leYWxu7j46GmfnJWFH3DnhvvlP/7SaQJbD+dMkyqTLXAGV1TQPMqBrObMJgvNT8EQC8AQ4mj0+E62kZAAAAAElFTkSuQmCC",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABHElEQVR4nO2WwRLDIAhE2U7//5fppVjUFVHTaQ/ZmVwSw74gEEVu/Vi4KI7uxjwFUBER1Y8/UEKmYu8CdMZd4CTIDoBGxgOQoc/jm+YZeQCVupguMX+/M3yxysBs8a6iuN0WuMVa3z7jGkF4AFjlquoIpJOr9ukaBhEWoYGoKjUCETYiA2wh0l1wuAXwIB6i6oLV/l6EAsuiARTzzJ6uqEk52npYHUSXQogkagBAudqg2WyRcVwgntK0BduKkwIM/gUwAGqQaS+fhV1II9uadC2EiWRx+jekLWJBRs/M3A+sVbWRWQT4+8yE1YufE9GZoO0CkKu8bF/MUj4DG2l16kwHlquJUl+R19GRjKR2+XR8dCglMcKvvXXrL/UCkH+5C6s6Dz0AAAAASUVORK5CYII=",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABAklEQVR4nO2V2xKDMAhE2U7//5fpi1iCXBJL60zHfdKY5CwkINGti4VgnJNvHWJ5eMxM6oYzMzFzbmCb0G2CBSzKMtBtYoADICJCaqDRhAsn8jNwgCkTZ4yE8OHBm+zJbpCBtw3TtU8PDoAKI1GZ7ouqQDwDU2JmieQAnoVqlZcwMkHvaIe6Xlg3GBjOfiGS8s5UCo/AptmCPgWXBroAleQI4Fysn+jQB4aXL2VB94Mq7CVDE/1j3cBqFuQoJztqauB0c9GAbA8AYRW48Cq6qHSzknb7uQeQ8y2qZepS673Kv6GO2sDP1C3brMD7aMHqvaNZCMTdUIcPM3ZNp7p16+/1AoBksuBmmrTtAAAAAElFTkSuQmCC",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABCElEQVR4nO2XwRLDIAhEodP//2V6aDa1gBEUc+h0T5mUuk8UJUzrkuaZs39+Jgb3A+Qdwpz2HgIIBoe0if59Ro+eOQxhyswkIqdphTnRJwMYjfHcGsB8hwCA3N5qTmSXwOykneYeQEiVUKMyDKmpjvSZ0AsyJXhl7sWqku3CLANEdMC4XldpMhWxAyKyTmXZ8CCmqqBStwIcmfxK5+0Z0BAhAO+qbS+qFUUOovOCas2rNmZ6CSpmvQSwOnM9gSgAV888C2A0C6QzmAFg7PxII6qrxImVLADRcYxGIUTE9JV4D5UcRCMIhDkQMt2QRPoAB8yeKRPew++FwLhnFz4F0Hm/p07/+nm9AC/+b1UxIU8OAAAAAElFTkSuQmCC",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABJ0lEQVR4nOWW2xLDIAhEl0z//5fpQ6NFJCAa04cy0+klsnsELwX+PWhgDN+gMZ3MzK0/EZUH9fMKhJfIygQaRkMltMNB7BlKU2vM+WwI4GUZn8mdsq6GNfOMuQUQJnpVmYkCoFVNkMg8O3sAOKS4MGAhuDUqgFxUo2WW44iofE/1qACQhJDiRJSqRBZCK4fbzxT5zr75TejLh43ngTa6Slhm+t0CFpVgr63hSbgaEtDaJeFdcJJsMQf6FnQan9zbtmM3kwiggmQh9OyvqjgKkIaIFmYVTQAInXsWJwDKVCArPhRbAK6u6scAMhCz+2toHWgA67jeVgHpA+c8mQWYPZy6PP2XLCvW9SG7RVdbQPo1UJlmzBNrwIVYacEyBPC7CmyP5sLx4g2TyYdbcQVdwQAAAABJRU5ErkJggg==",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABH0lEQVR4nOVX0RLCIAwrnv//y/EFbgVaGjp2emdedFLSUCCrIhzgfI7j7fs47uLFBpIAAAEwinLxjgiTYzQKGTclq6u8iIpLtcxBCwAgpZQp8USoYqqoZQ76DBjE03hVuqpGSgAaMYsdEadvwTYYmdhZfUdOnIFIgJnZE5S5CZSAJysQnYHSiPTqxpVaz0xyKkCUB6gfZqJh/KgAL+mS+BJ0xgm7B/4QHqlAzZmqQMhPOWHmFrCv5EhA2oRYEV+34p8UsNXTbcDkHQXoPYfI0t9DqLlur2j2hPrgNVvNGlHYQdn5n9gB2xu8+l77MFSjC3JatMWcfauUfs90POA3n96cCdH/Ao8g2ib65GZ8AEaJ01fllhHdTX4HT5nVH+IDSk+VHrQ/yTUAAAAASUVORK5CYII=",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABHUlEQVR4nOVWWw7DMAiDqfe/MvvoQ4xAMHlok2ZpmloS7AIhEGGQ66efrd37T/FCyEWERKTkGMUxsTcTc9t5iQDmx88ZChFrt+HvEj/7gDVykzFzQ9wRCglAaqAhVyQNcbVeIAHIl48CjsAulGqg7PxMS5cjE+AyR4K82sh4UgEzuV8RASIVheg4es+of7gGdHi9qFg78vWwgIi06xiMAtStyBRjoQiXRODiHIpA6h++jqtA23EmYOoYIiK+3op/UoCd/1bB9WsF6JwLUbe/p9BTVDQnuCOZbasj84AeULrrfP49w4fXG6L4NheQckDWFr13bPVWSZ850+vFCGBgT4PxCjOpQluvxUwfYOeKLhfPbCPimWO6Erua1x/gDfHvngq4OJEYAAAAAElFTkSuQmCC",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA/ElEQVR4nO2WUQ/DIAiEj2X//y+zF2ksgmCL3UsvWbJM4nfisRbYL24fU5/dcGaXvd1ACAeA7x/hDABUDW70YYHoQBG6TFQaSLW8MwKgLgMpeCvcYiCUPvnjBrSkE48b0J3YNYYuXGfgioEhbcxsbi5QqTFNrYKzaY8kxrIG0mOWBTc2ZwxM4VGLDbDAz1+uwDXAvWcHDszHcKntEsSJSMMjA8tKmBjkjWFJ6FTg0gZuk2d3HhkoG7cILOozcBueabln4AQnojBMuuYKXIoHuLdmmUjsnypg4zfoNe9hYx2gG8mpCbkCgvNH0a9ZJ76dm8X6VVr1W/erV/X6AU6CeC0t3vKrAAAAAElFTkSuQmCC",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABCElEQVR4nO2WzRKDMAiE2Y7v/8r0kqSISVzS0F5kxoPK8G34U5F803J17ZUNVx2y0XcwjMFUHARkWM3uNBpf+yEz8BAQ1nmNgF0youQytXsKfDgWp6m9mcCRvYXATYLqQIA+NRffRbiXiKpqgAYQ5wI04ihKYjO+NCsAHYR0WPWAdkgfgypElAL5k7g6iIKLRjG12cF8mkqLyacdlaE9T8KSQBoR0TIRtPgT21ftT3gVuRS012imz1gOTY2PIxtqhnUP3L3p5K3r9KOEzsBVDlrCTCpUxq853hKQ2T+V+CMM/uXsxqf24RGTVeEb2Kzcm8ZzOcY9eqd+NvmjXZelLbzp/exx3LsDfOJkxZk2B+5AAAAAElFTkSuQmCC",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA+UlEQVR4nO2VSw6AIAxEKfH+V64bwfIpTPm5cRKNgdB50FKd08XPs1W+NcnMAeQbgBMQXYDdEB4NLCCWgtATkKSXMKwvIgprlwNwy3gHhKyBaP4EPyKoCE8AwEe/CyCRTMXudMgiLGpAOxUicsyswZmIqwAzElAQSPUa5jsbAUOv6VAjEgbTDSsAvO7AbkMNIOpBmHNvMe9AsBysRsyNRswVgFhrXoxUDVf0gex3npz49XpRGC2OamEzKtJtiQzdDlQhLZafEYmFS8zjy6jkJAz9IBkqPhBTdXKiGSEASXuWZtq1zHbc9LhakwCZZg6ndkkKJuL++vW9bhYolBau0DkQAAAAAElFTkSuQmCC",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABA0lEQVR4nO2WSw7DIAxEPVHuf2V30TgyCP8SoJuOVKkthHkG24HIFl+fpTq8QWYWkN8A7IA4KLHVKyHQLXz/vkzbyYCetwRgaGyATIFociBjruZNOZJhEqqtXq6DKB/5MgDRzshFp3yRXdgNga+3XXLWGDNbsKUI3Lp/omqvEIBVICFEP+F2j0C8I6pAjAZDCMmBjCKIUSOC90DFnCjumuHr+I15Rh4AAEzpC94unKM/NQQR8cTmJBXXGFQefn0EfVKWcsDpfqU1SB1HBQCjFpzJk36OhsiGk7kzmuZkdFoAKQDWUfcLBHdHMW/W02NRFURklrkX2KMqqKb+/pvNX3891QdsP4ApjDDinQAAAABJRU5ErkJggg==",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABBElEQVR4nN2X2wrDQAhEx9L//+XpQ7PB7FVdE2gHCoVtnIOuxgJ/JB4fl15Z5iRBsoA8CsDDOKRdgIu5iACAPAmwZQ4A74DXLN/6zATjJTbX25oRTwlcl83aEVaA0E23QFgAttpsBbECaMyP2g61OvcCNMFJDk1W516AYdp6JsXcG68HQKjZXowMBl3A8py6C5cgNYB+qZzBrCaj3+nv9aWsizVNey1dhtV5RwK0o3j0RBfMWJIpRdrLKKrfBJjNgUcAMnUbgDUbVgAZtdyqFbMAGrOZqWdqelcyEZEzckYmIjsh8B0u7GRE4PxfEAXQhkWhreWWLsjaBzYZ8rdi/5j7BX0ADfCTHKrbEI8AAAAASUVORK5CYII=",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABCklEQVR4nNWX4Q7DIAiEYdn7vzL7MW3QgnLIlvSSJUus3KcopUQPlrTfkV5ZcxEhEekgaTFq3NzHIMyZWCmAC6QKIpsCbobHeoPP7/Ktx0OEyDJu274MHExJNAWQeZtAFLghEQDYHIHYAaTNoxDwLdidfvR2QADMTCLimuzGUQB32yyTbo7GswCEVK3vRgEDE7DPU2dhCDID6JfMFSxq4j2n/8+Hck7Wcttn6TTsxg0x0b0UezNMsGBKlhTZl1GZngmwqgN/AahUGKCqAUkDaOnT713F6n7ArfGJ+z8IaslmCG8n6LvyUJFAe8LBwFhp2PgUQBt2pToXuB+oVhSAsx8eVQAZ/aZwVOsDqwuPItm/Ur4AAAAASUVORK5CYII=",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABCklEQVR4nO2WSw7DMAhEcdX7X9ldJFQO5jfYirLISFmkJcOTwcZEr3D189miT4mg920gJQCGGEDuBxhBViAsgE7AEq+UpNmeh1drl5DGSfj/yfCIt3xxAMXcTF6B8IJUCC2ZAxtCbGlCUSZIywAMwUJhIIDI3CpHFaDJhNpyj+9ocqK4SVKNKEGS3ukg9UyQdVf6YBvABcI0KkIgLTsRJLo/9P8CANKsAjSpeg70lb0/ClkBNfn5QxkARU81I+KdKUFqzhuTMvw2KsF4BqhGzoiW38LbZFpuLVn2/LfOBWgXrDQbW5Aoi1uC7A2IY71blPThsphXMivxmAiZhNawcgGS+l9UgfhXz9EPsSqlDRy22m8AAAAASUVORK5CYII=",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABCUlEQVR4nO2W0a7EIAhEnZv9/1/2vpRdtB0YXLtPnaRJExEPKGhrjx5p6se3XX8yQe+3gMgABrEbpARAQH4P4EHal9mA9xeNHYtxR4DNMUNw64+GDFhqp8ik6PyWVLbn5f4B4B1pFvEuLZ2BI923ACBzDqCSndTwKgMUorK4WqrLZQhA2ooMgnkYJsxRs0wYUDB2Wo8CVKvAoKoQdAssxeZQPfll8MgXc8ii9JBqBpSwTp6iKKNKKW2Bn+e+NMX+HChSAG57DSkAPWsoarTMLgIYStH+lVYdDVcAroiW7FgTam28jk+KmoqiKRtXTsAAaA+4WmAuvawfOLsu3QWJ/DOsqn0Pi0er+gdkMKQLf5051AAAAABJRU5ErkJggg==",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA9klEQVR4nO2VzRLDIAiEs528/yvTS5NRyvKjTHsJx6jwueDmOJ54Yi2kK9FrpbiItEEwgDB5F4QFkL5hBwRtAUl+wbVBuDPwCyXCIRySf92+A+LMbPIK74alAAAsJVtRYcUH7lgFHSPVAla4ozVlAAC08AesJAvbPFUICt7rQUvMRaqAJ2/UAus7ALEg0gpo6dltE+DTQU8zYQnH4pVBrAJMINMH1XOtTGVIqw/ZtGOtCIOwADLP8MpEYXf8IHJCERHXYnfd0AOY5E6+dbrOTKr0L8hKXWmJOwO7nm+ooROBAVAPsAp4JhUYk6ScMAgU9+uzT/w33t2WoP+qWuSTAAAAAElFTkSuQmCC",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA70lEQVR4nO1Wyw7DMAgr0/7/l73LmAglBJNKU6X6VDUBm0dCjuPBDYHN9QEvlhxARrJa3xagLBGJklNgBJQJmCy0MhCQtKJnBGQE4UI1C++igJi5GbVFqwQiQv2/XMCVuKeAWe07PUE1oa2xkonI8M2KYbqGOutfMUv/TAmk2uVV8vImh18abEacuLLfzkWkzqN60AF1j+GpH9gxvCNg2owdEd0HSbaBElERAMYha7sSAABpVMnRXNquBAzpjm67TFBgG4qgeoB8kpWQ3gNRNCxcxrwjmQlAhVid24F0chQMLWOPWUGZkIXc720f/BcfQ6ib3RoDepoAAAAASUVORK5CYII=",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABBElEQVR4nO2W0Q7DIAhFYdmH98/ZEwkiIhebLE16X5bVyj0iRYlePVByOD7og5qLSGayGz8GUJfIRM0hIQBlAyQLrQwEJq3VIwCZQThQzcK3CEBERMw8GHgoP14RBGCDMjOJyPSLCq4BXaWaejj7rKJyBqyx/r/MmD73YLcBIOlFstH+DO8SsmEyFaEJsvgitvGxigkg6MC8A0BkmksEg8aF+oALHlUlvKBuEU6tGT2GTwCW50IHonshyV6AICoAggRE5+4AxJx6YaCk223n7gCGdFfba9QbMgioBsArWUlpH1h1OkQuYz4QrwCkYqzBs8uI3bqgZctqQ5ElM/i+n/vqv/oBKoa/WI/BrT0AAAAASUVORK5CYII=",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA1ElEQVR4nO1USQ7EIAxzRvP/L6eXgUlTstDCpYqlqmyJTTAAhUKhUCjsB3uTn93kzOyKWCHASt7IXTwVYO0wRQ4A3wXkvR+tB0B6cLYC3D5J3tr6fwo0vJAV0Emt0jIziC4bPM2NRIwjLvH/GJFoGkJgb+y+hiEiAWk3T6In9QQsJW/l1zmnj0CajYhM40lizzdP3oGeVIqYMCwDcOW7R2Alj8blHwDdvgXWvddVkUcwWh+9A6ERIw9oQaofRP9yeIkjQZJw4JmUgLQoqSOx7i73y3AA4giQ7eL+8PYAAAAASUVORK5CYII=",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA10lEQVR4nO2UUQ7EIAhEYbP3vzL7wxo6IqKpadIwSWNKlXmClahUKpVKpbMSfYb6nDQXCb1vARg5zJ1vABAYrx919zoOgb6bpi05M4cGsJYxmK2AkPYUdnYZMYawHmhH5JljQmbuTLQSrrldo/Oa7wwgZZ7VH9L6nvwNU3oKoJUwAkhdJBmZ0nftW66AOUjEzO2JzKONrN4DHYw18mKBuRARb50BWwUbw7gHg1Dbh9CDsKbYptH85XugSxD03wOC98lqzRElngFZQ4TJAqShLEdi3q73y/QDzYaO9US4bAEAAAAASUVORK5CYII=",
];

const Cat = () => {
  const ref = useRef<NekoEngine | null>(null);
  const pawRef = useRef("");
  const lastPrintRef = useRef(0);

  useEffect(() => {
    pawRef.current = makePawPrint();
    const engine = new NekoEngine({ speed: 24, fps: 120, behaviorMode: 0, idleThreshold: 6, allowBehaviorChange: false });
    engine.setSprites(CAT_SPRITES);
    engine.start();
    ref.current = engine;

    // easter egg: after 15s idle → cat runs to toggle, wall-scratches, runs back, sleeps (once)
    let phaseTimer: ReturnType<typeof setTimeout>;
    let busy = false;
    let played = false;
    let lastActivity = Date.now();
    const originalChase = engine.chaseMouse.bind(engine);
    let savedMx = 0;
    let savedMy = 0;

    const abort = () => {
      busy = false;
      clearTimeout(phaseTimer);
      engine.chaseMouse = originalChase;
    };

    const onActivity = () => { lastActivity = Date.now(); abort(); played = false; };

    // after 15s idle, regardless of cat state: wake, run to toggle, play, run back, sleep
    const idleWatcher = setInterval(() => {
      if (busy || played) return;
      if (Date.now() - lastActivity < 15000) return;

      busy = true;
      savedMx = engine.mx ?? engine.x + 30;
      savedMy = engine.my ?? engine.y + 30;

      // phase 1: wake and run toward toggle using engine animation
      engine.setState(5); // awake
      engine.chaseMouse = function(this: any) {
        this.runTo(window.innerWidth - 80, 24);
        const dx = window.innerWidth - 80 - this.lx - 16;
        const dy = 24 - this.ly - 31;
        if (Math.sqrt(dx*dx + dy*dy) < 20) {
          // phase 2: wall-scratch + random toggles
          engine.chaseMouse = function() {};
          engine.setState(14); // wall-scratch (pawing at top edge / button)
          let count = 0;
          const max = 2 + Math.floor(Math.random() * 3);
          const scheduleToggle = () => {
            if (!busy) return;
            const dark = document.documentElement.classList.contains("dark");
            document.documentElement.classList.toggle("dark", !dark);
            localStorage.setItem("theme", dark ? "light" : "dark");
            count++;
            if (count < max) {
              phaseTimer = setTimeout(scheduleToggle, 300 + Math.random() * 1200);
            } else {
              // phase 3: run back to cursor
              engine.setState(5); // awake
              engine.chaseMouse = function(this: any) {
                this.runTo(savedMx - 30, savedMy - 30);
                const dx2 = savedMx - 30 - this.lx - 16;
                const dy2 = savedMy - 30 - this.ly - 31;
                if (Math.sqrt(dx2*dx2 + dy2*dy2) < 20) {
                  engine.setState(4); // sleep
                  engine.chaseMouse = originalChase;
                  busy = false;
                  played = true;
                }
              };
            }
          };
          phaseTimer = setTimeout(scheduleToggle, 400 + Math.random() * 1400);
        }
      };
    }, 500);

    document.addEventListener("mousemove", onActivity);
    document.addEventListener("keydown", onActivity);

    const trailLoop = () => {
      const eng = ref.current;
      if (!eng || !document.body.contains(eng.el) || !pawRef.current) {
        requestAnimationFrame(trailLoop);
        return;
      }

      const now = Date.now();

      if (now - lastPrintRef.current > 80 && (Math.abs(eng.x - eng.plx) > 0.5 || Math.abs(eng.y - eng.ply) > 0.5)) {
        lastPrintRef.current = now;
        // paw print — more visible, fades over distance and time
        const paw = document.createElement("img");
        paw.src = pawRef.current;
        paw.style.cssText = `
          position:fixed;left:${eng.x + 22}px;top:${eng.y + 50}px;
          width:16px;height:14px;opacity:0.18;pointer-events:none;z-index:0;
          transition:opacity 3s ease-out;
        `;
        document.body.appendChild(paw);
        setTimeout(() => { paw.style.opacity = "0"; }, 80);
        setTimeout(() => { paw.remove(); }, 3100);

        // dust trail particles
        for (let i = 0; i < 3; i++) {
          const dust = document.createElement("div");
          const ox = (Math.random() - 0.5) * 16;
          const oy = (Math.random() - 0.5) * 10;
          dust.style.cssText = `
            position:fixed;left:${eng.x + 28 + ox}px;top:${eng.y + 52 + oy}px;
            width:4px;height:4px;border-radius:50%;background:#e06b20;
            opacity:0.12;pointer-events:none;z-index:0;
            transition:opacity 2s ease-out;
          `;
          document.body.appendChild(dust);
          setTimeout(() => { dust.style.opacity = "0"; }, 60);
          setTimeout(() => { dust.remove(); }, 2100);
        }
      }

      requestAnimationFrame(trailLoop);
    };

    const raf = requestAnimationFrame(trailLoop);
    return () => {
      cancelAnimationFrame(raf);
      abort();
      document.removeEventListener("mousemove", onActivity);
      document.removeEventListener("keydown", onActivity);
      engine.destroy();
    };
  }, []);

  return null;
};

export default Cat;
