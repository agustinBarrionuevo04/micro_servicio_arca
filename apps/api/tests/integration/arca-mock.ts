import { vi } from 'vitest';

export const arcaMockFns = {
  createVoucher: vi.fn(),
  getLastVoucher: vi.fn(),
  getServerStatus: vi.fn(),
};

export function resetArcaMock(): void {
  arcaMockFns.createVoucher.mockReset();
  arcaMockFns.getLastVoucher.mockReset();
  arcaMockFns.getServerStatus.mockReset();

  arcaMockFns.createVoucher.mockImplementation(
    async (voucher: { CbteDesde: number; CbteHasta: number }) => ({
      response: {
        FeCabResp: {},
        FeDetResp: {
          FECAEDetResponse: [
            {
              Resultado: 'A',
              CAE: `CAE-${voucher.CbteDesde}`,
              CAEFchVto: '20261231',
              CbteDesde: voucher.CbteDesde,
              CbteHasta: voucher.CbteHasta,
            },
          ],
        },
        Events: {},
        Errors: {},
      },
      cae: `CAE-${voucher.CbteDesde}`,
      caeFchVto: '20261231',
    })
  );

  arcaMockFns.getLastVoucher.mockResolvedValue({ cbteNro: 0, cbteTipo: 11, ptoVta: 1 });
  arcaMockFns.getServerStatus.mockResolvedValue({
    appServer: 'OK',
    dbServer: 'OK',
    authServer: 'OK',
  });
}

export function mockArcaRejection(message = 'CUIT del comprador inválido'): void {
  arcaMockFns.createVoucher.mockReset();
  arcaMockFns.createVoucher.mockImplementation(
    async (voucher: { CbteDesde: number; CbteHasta: number }) => ({
      response: {
        FeCabResp: {},
        FeDetResp: {
          FECAEDetResponse: [
            {
              Resultado: 'R',
              CAE: '',
              CAEFchVto: '',
              CbteDesde: voucher.CbteDesde,
              CbteHasta: voucher.CbteHasta,
              Observaciones: {
                Obs: [{ Code: 10016, Msg: message }],
              },
            },
          ],
        },
        Events: {},
        Errors: {},
      },
      cae: '',
      caeFchVto: '',
    })
  );
}
